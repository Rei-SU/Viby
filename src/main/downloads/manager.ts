import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  DownloadCollectionInput,
  DownloadJobView,
  DownloadProgress,
  DownloadsSnapshot,
  Quality,
  Track
} from '@shared/types'
import { ensureRunner, pluginArgs } from '../ytdlp/binary'
import { runStreamed } from '../ytdlp/exec'
import { isSafeYtDlpInput } from '../ytdlp/resolver'
import { getLyrics } from '../lyrics'
import { fetchArt } from './art'
import type { DownloadJob, DownloadsStore } from './store'

const MIN_FREE_BYTES = 500 * 1024 * 1024
const DEFAULT_ESTIMATE_BYTES = 12 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const PROGRESS_THROTTLE_MS = 250
const MAX_ATTEMPTS = 3

type Active = {
  id: string
  controller: AbortController
  paused: boolean
  cancelled: boolean
}

export type DownloadManagerOptions = {
  isOffline: () => boolean
  onProgress: (progress: DownloadProgress) => void
  onChanged: () => void
  onCompleted: (trackId: string) => void
  /** True while a job is running or waiting; used for the power blocker. */
  onBusy?: (busy: boolean) => void
  /** The track currently loaded in the player; its file must not be unlinked. */
  isPlaying?: (trackId: string) => boolean
}

function numberOrUndefined(value: string | undefined): number | undefined {
  if (!value || value === 'NA') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * yt-dlp progress payload (PLAN §17.6): `downloaded total estimate speed`,
 * where any field may be `NA`. Missing totals become an indeterminate row
 * rather than a bogus 0%.
 */
export function parseProgressLine(payload: string): Partial<DownloadJobView> {
  const [downloaded, total, estimate, speed] = payload.trim().split(/\s+/)
  const bytes = numberOrUndefined(downloaded)
  const totalBytes = numberOrUndefined(total) ?? numberOrUndefined(estimate)
  const speedBps = numberOrUndefined(speed)
  const percent =
    bytes !== undefined && totalBytes && totalBytes > 0
      ? Math.min(100, Math.round((bytes / totalBytes) * 100))
      : undefined

  return { downloadedBytes: bytes, totalBytes, speedBps, percent }
}

function errorLine(stderr: string, code: number): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const error = [...lines].reverse().find((line) => line.startsWith('ERROR:'))
  return (error ?? lines.pop() ?? `yt-dlp exited with code ${code}`).replace(/^ERROR:\s*/, '')
}

/** Retryable network hiccups, as opposed to a track that will never download. */
export function transient(message: string): boolean {
  return (
    /timed? ?out|network|connection|temporar|socket|http 5\d\d|unable to download|fragment/i.test(
      message
    ) && !/unavailable|private|sign in|bot|unsupported|not found|does not exist/i.test(message)
  )
}

/**
 * One download at a time (PLAN §17.6): playback keeps the CPU and the queued
 * files are not going anywhere. The queue is persisted in the store, so a quit
 * turns into a resume instead of a restart.
 */
export class DownloadManager {
  private queue: string[] = []
  private active: Active | null = null
  private progress = new Map<string, Partial<DownloadJobView>>()
  private changedTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private lastProgressAt = 0
  private estimateReported = new Set<string>()
  private busy = false
  private backfillingLyrics = false
  private shuttingDown = false

  constructor(
    private readonly store: DownloadsStore,
    private readonly opts: DownloadManagerOptions
  ) {}

  start(): void {
    for (const { id, job } of this.store.allJobs()) {
      if (job.state === 'failed') continue
      if (this.store.has(id)) {
        this.store.deleteJob(id)
        continue
      }
      this.store.setJobState(id, 'paused')
      this.enqueue(id)
    }
    this.publish()
    this.pump()
    void this.backfillLyrics()
  }

  addTrack(track: Track, quality: Quality): void {
    const added = this.store.enqueue([{ track, source: `track:${track.id}` }], quality)
    for (const id of added) this.enqueue(id)
    this.publish()
    this.pump()
  }

  addCollection(input: DownloadCollectionInput, tracks: Track[], quality: Quality): void {
    this.store.addCollection(input)
    const source = input.key
    // Album rows often carry no thumbnail of their own; snapshot the collection
    // cover so the downloaded file gets artwork instead of a blank square.
    const fallback = input.thumbnail
    const normalized = tracks.map((track) =>
      !track.thumbnail && fallback ? { ...track, thumbnail: fallback } : track
    )
    const added = this.store.enqueue(
      normalized.map((track) => ({ track, source })),
      quality
    )
    for (const id of added) this.enqueue(id)
    if (input.thumbnail) void this.cacheCollectionArt(input.key, input.thumbnail)
    this.publish()
    this.pump()
  }

  removeTrack(trackId: string): void {
    this.stop(trackId, false)
    this.queue = this.queue.filter((id) => id !== trackId)
    this.progress.delete(trackId)
    this.store.removeTrack(trackId, this.opts.isPlaying?.(trackId) ?? false)
    this.publish()
  }

  /** Keep the collection snapshot honest after the library changes. */
  syncCollection(key: string, trackIds: string[]): void {
    this.store.syncCollection(key, trackIds)
    this.publish()
  }

  pruneCollection(key: string, trackIds: string[]): void {
    const affected = new Set(
      this.store.pruneCollection(key, trackIds, (id) => this.opts.isPlaying?.(id) ?? false)
    )
    for (const id of affected) {
      this.queue = this.queue.filter((queued) => queued !== id)
      this.progress.delete(id)
      if (this.active?.id === id) {
        this.active.cancelled = true
        this.active.controller.abort()
      }
      rmSync(this.store.tmpDirFor(id), { recursive: true, force: true })
    }
    this.publish()
  }

  removeCollection(key: string): void {
    const affected = new Set(
      this.store.removeCollection(key, (id) => this.opts.isPlaying?.(id) ?? false)
    )
    for (const id of affected) {
      this.queue = this.queue.filter((queued) => queued !== id)
      this.progress.delete(id)
      if (this.active?.id === id) {
        this.active.cancelled = true
        this.active.controller.abort()
      }
      rmSync(this.store.tmpDirFor(id), { recursive: true, force: true })
    }
    this.publish()
  }

  cancel(trackId: string): void {
    this.queue = this.queue.filter((id) => id !== trackId)
    this.stop(trackId, false)
    this.progress.delete(trackId)
    this.store.deleteJob(trackId)
    rmSync(this.store.tmpDirFor(trackId), { recursive: true, force: true })
    this.publish()
  }

  retry(trackId: string): void {
    const job = this.store.job(trackId)
    if (!job || job.state !== 'failed') return
    this.store.setJobState(trackId, 'queued', { error: undefined, attempts: 0 })
    this.enqueue(trackId)
    this.publish()
    this.pump()
  }

  clear(): void {
    if (this.active) {
      this.active.cancelled = true
      this.active.controller.abort()
    }
    this.queue = []
    this.progress.clear()
    const playing = this.store
      .entries()
      .find((entry) => this.opts.isPlaying?.(entry.track.id))
    this.store.clear(playing?.track.id)
    this.publish()
  }

  /**
   * Called when connectivity changes. `available` means the host is actually
   * reachable — an `unreachable` captive portal is not a reason to burn retries.
   */
  onNetworkChange(available: boolean): void {
    if (!available) {
      this.pauseAll()
      return
    }

    for (const { id, job } of this.store.allJobs()) {
      if (job.state !== 'paused') continue
      this.store.setJobState(id, 'queued')
      this.enqueue(id)
    }
    this.publish()
    this.pump()
    void this.backfillLyrics()
  }

  async snapshot(): Promise<DownloadsSnapshot> {
    return this.store.snapshot(this.store.jobViews(this.progress))
  }

  shutdown(): void {
    this.shuttingDown = true
    if (this.changedTimer) clearTimeout(this.changedTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.changedTimer = null
    this.retryTimer = null
    // Do not let the aborted job's finally start the next queued download while
    // the app is quitting; that child would have no owner.
    this.queue = []
    if (this.active) {
      this.active.paused = true
      this.store.setJobState(this.active.id, 'paused')
      this.active.controller.abort()
    }
  }

  private enqueue(id: string): void {
    if (!this.queue.includes(id)) this.queue.push(id)
  }

  private pauseAll(): void {
    this.queue = []
    for (const { id, job } of this.store.allJobs()) {
      if (job.state === 'queued' || job.state === 'downloading') {
        this.store.setJobState(id, 'paused')
      }
    }
    if (this.active) {
      this.active.paused = true
      this.active.controller.abort()
    }
    this.publish()
  }

  /** Abort the active child without deleting its persisted job. */
  private stop(trackId: string, paused: boolean): void {
    if (this.active?.id !== trackId) return
    this.active.paused = paused
    this.active.cancelled = !paused
    this.active.controller.abort()
  }

  private pump(): void {
    if (this.shuttingDown || this.active || this.queue.length === 0) return
    if (this.opts.isOffline()) return

    const id = this.queue.shift()
    if (!id) return
    const job = this.store.job(id)
    if (!job) {
      this.pump()
      return
    }
    if (this.store.has(id)) {
      this.store.deleteJob(id)
      this.pump()
      return
    }
    void this.run(id).catch((err: unknown) => {
      // run() handles its own errors; this is the last line of defence so a
      // programming mistake cannot become an unhandled rejection.
      console.error('[downloads] job crashed', err)
      this.active = null
      this.publish()
      this.pump()
    })
  }

  private async run(id: string): Promise<void> {
    if (this.shuttingDown) return
    const job = this.store.job(id)
    if (!job) {
      this.pump()
      return
    }

    const controller = new AbortController()
    this.active = { id, controller, paused: false, cancelled: false }
    const attempts = job.attempts + 1
    this.store.setJobState(id, 'downloading', { attempts, error: undefined })
    this.progress.set(id, { downloadedBytes: 0, percent: 0 })
    this.publish()

    let finalPath = ''
    let tmpDir = ''

    try {
      const estimate = job.estimateBytes ?? DEFAULT_ESTIMATE_BYTES
      const freeBytes = await this.store.freeBytes()
      // A filesystem that cannot report free space must not block downloads.
      if (freeBytes !== null && freeBytes < MIN_FREE_BYTES + estimate) {
        throw new Error('Not enough disk space to finish this download.')
      }

      const runner = await ensureRunner()
      const safe = this.store.safeId(id)
      tmpDir = this.store.tmpDirFor(id)
      mkdirSync(tmpDir, { recursive: true })
      const input =
        job.track.sourceUrl?.trim() || `https://music.youtube.com/watch?v=${job.track.id}`
      if (!isSafeYtDlpInput(input)) throw new Error('This track has an invalid download URL.')
      const format =
        job.quality === 'data-saver' ? 'bestaudio[abr<=64]/bestaudio/best' : 'bestaudio/best'

      const result = await runStreamed(
        runner.command,
        [
          ...runner.prefix,
          '--no-playlist',
          '--no-warnings',
          '--continue',
          '--progress',
          '--newline',
          '--progress-template',
          'download:VIBY %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s',
          '--print',
          'after_move:filepath',
          '--socket-timeout',
          '15',
          '-f',
          format,
          ...pluginArgs(),
          '-o',
          join(tmpDir, `${safe}.%(ext)s`),
          '--',
          input
        ],
        {
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
          signal: controller.signal,
          onStdoutLine: (line) => {
            if (line.startsWith('VIBY ')) {
              this.handleProgress(id, line.slice(5))
              return
            }
            if (/^([A-Za-z]:\\|\/)/.test(line)) finalPath = line
          }
        }
      )

      if (this.active?.cancelled) return
      if (this.active?.paused) {
        this.store.setJobState(id, 'paused')
        return
      }
      if (result.timedOut) {
        // A timeout usually leaves a resumable .part file. Classifying it as a
        // permanent yt-dlp exit code would make large downloads fail for good.
        throw new Error('Download timed out — the partial file can resume.')
      }
      if (result.code !== 0) {
        throw new Error(errorLine(result.stderr, result.code))
      }

      const file = finalPath && existsSync(finalPath) ? finalPath : this.findDownload(tmpDir, safe)
      if (!file) throw new Error('Downloaded file was not found')

      const ext = file.split('.').pop()?.toLowerCase() ?? 'm4a'
      const art = await this.artFor(job.track)
      const current = this.store.job(id)
      this.store.put(job.track, file, ext, current?.sources ?? job.sources, job.quality, art ?? undefined)
      this.progress.delete(id)
      this.opts.onCompleted(id)
      void this.storeLyrics(job.track)
      this.publish()
    } catch (err) {
      if (this.active?.cancelled) return
      if (this.active?.paused) {
        this.store.setJobState(id, 'paused')
        return
      }

      const message = err instanceof Error ? err.message : String(err)
      const current = this.store.job(id)
      const tries = current?.attempts ?? attempts
      if (transient(message) && tries < MAX_ATTEMPTS) {
        this.store.setJobState(id, 'queued', { error: undefined })
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null
          this.enqueue(id)
          this.publish()
          this.pump()
        }, 2_000 * tries)
      } else {
        // Do not leave a frozen percentage/speed on a permanently failed row.
        this.progress.delete(id)
        this.store.setJobState(id, 'failed', { error: message })
      }
      this.publish()
    } finally {
      this.estimateReported.delete(id)
      try {
        if (tmpDir) {
          // Keep a partial when the job is paused or queued for a retry; it is
          // the resume point. Finished, cancelled and permanently failed jobs
          // clean up. A cleanup failure must never wedge the queue.
          const state = this.store.job(id)?.state
          if (state !== 'paused' && state !== 'queued') {
            rmSync(tmpDir, { recursive: true, force: true })
          }
        }
      } catch {
        // Windows can hold the temp file briefly (AV, killed child). The next
        // launch sweeps orphaned temp dirs.
      }
      this.active = null
      // Publish after clearing `active` so onBusy(false) actually fires when the
      // queue drains; otherwise the power blocker stayed on indefinitely.
      this.publish()
      this.pump()
    }
  }

  private handleProgress(id: string, payload: string): void {
    const parsed = parseProgressLine(payload)
    const { totalBytes } = parsed
    this.progress.set(id, parsed)

    // Persist the reported total once so a retry can guard disk space properly.
    if (totalBytes && !this.estimateReported.has(id)) {
      this.estimateReported.add(id)
      this.store.setJobEstimate(id, totalBytes)
    }

    const now = Date.now()
    if (now - this.lastProgressAt < PROGRESS_THROTTLE_MS) return
    this.lastProgressAt = now
    this.opts.onProgress({
      trackId: id,
      state: 'downloading',
      ...parsed
    })
  }

  private findDownload(dir: string, safe: string): string | null {
    try {
      for (const name of readdirSync(dir)) {
        if (name.startsWith(safe) && !name.endsWith('.part') && !name.endsWith('.ytdl')) {
          return join(dir, name)
        }
      }
    } catch {
      // Directory removed by a cancel, or never created.
    }
    return null
  }

  private async cacheCollectionArt(key: string, url: string): Promise<void> {
    const art = await fetchArt(url, this.store)
    if (!art) return
    this.store.setCollectionArt(key, art)
    this.publish()
  }

  /**
   * Cover for one downloaded track: its own thumbnail when it has one, else the
   * cover of a downloaded collection it belongs to.
   */
  private async artFor(track: Track): Promise<string | null> {
    const direct = await fetchArt(track.thumbnail, this.store)
    if (direct) return direct

    const owner = this.store.collections().find((collection) =>
      collection.trackIds.includes(track.id)
    )
    if (!owner) return null
    if (owner.art) return owner.art
    return owner.thumbnail ? fetchArt(owner.thumbnail, this.store) : null
  }

  /**
   * Lyrics are part of a download, not a nice-to-have: pin them next to the
   * audio so the lyrics panel works with no connection. Failures never fail the
   * download.
   */
  private async storeLyrics(track: Track): Promise<void> {
    if (this.opts.isOffline()) return
    if (this.store.lyrics(track.id)) return
    try {
      const lyrics = await getLyrics({
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        durationSec: track.durationSec ?? 0,
        album: track.album
      })
      if (lyrics.kind !== 'none') this.store.putLyrics(track.id, lyrics)
    } catch {
      // Lyrics are optional; the download itself already succeeded.
    }
  }

  /**
   * Downloads made before lyrics were saved with the audio get a free top-up the
   * first time the app is online. Stored tracks are skipped, so this is cheap
   * after the first pass.
   */
  private async backfillLyrics(): Promise<void> {
    if (this.backfillingLyrics || this.opts.isOffline()) return
    this.backfillingLyrics = true
    try {
      for (const entry of this.store.entries()) {
        if (this.opts.isOffline()) return
        if (this.store.lyrics(entry.track.id)) continue
        await this.storeLyrics(entry.track)
      }
    } finally {
      this.backfillingLyrics = false
    }
  }

  private publish(): void {
    this.updateBusy()
    if (this.changedTimer) return
    this.changedTimer = setTimeout(() => {
      this.changedTimer = null
      this.opts.onChanged()
    }, 60)
  }

  private updateBusy(): void {
    if (!this.opts.onBusy) return
    // A queued job while offline is not doing work; keeping the power blocker
    // on forever drained the battery for nothing.
    const busy = this.active !== null || (this.queue.length > 0 && !this.opts.isOffline())
    if (busy === this.busy) return
    this.busy = busy
    this.opts.onBusy(busy)
  }
}

export type { DownloadJob }
