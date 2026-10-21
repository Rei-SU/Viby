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
    const added = this.store.enqueue(
      tracks.map((track) => ({ track, source })),
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
    this.store.removeTrack(trackId)
    this.publish()
  }

  /** Keep the collection snapshot honest after the library changes. */
  syncCollection(key: string, trackIds: string[]): void {
    this.store.syncCollection(key, trackIds)
    this.publish()
  }

  pruneCollection(key: string, trackIds: string[]): void {
    const affected = new Set(this.store.pruneCollection(key, trackIds))
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
    const affected = new Set(this.store.removeCollection(key))
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
    this.store.clear()
    this.publish()
  }

  /** Called when connectivity changes: stop cleanly or pick the queue back up. */
  onNetworkChange(offline: boolean): void {
    if (offline) {
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
  }

  async snapshot(): Promise<DownloadsSnapshot> {
    return this.store.snapshot(this.store.jobViews(this.progress))
  }

  shutdown(): void {
    if (this.changedTimer) clearTimeout(this.changedTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.changedTimer = null
    this.retryTimer = null
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
    if (this.active || this.queue.length === 0) return
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
    void this.run(id)
  }

  private async run(id: string): Promise<void> {
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
      if ((await this.store.freeBytes()) < MIN_FREE_BYTES + estimate) {
        throw new Error('Not enough disk space to finish this download.')
      }

      const runner = await ensureRunner()
      const safe = this.store.safeId(id)
      tmpDir = this.store.tmpDirFor(id)
      mkdirSync(tmpDir, { recursive: true })
      const input =
        job.track.sourceUrl?.trim() || `https://music.youtube.com/watch?v=${job.track.id}`
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
      if (result.code !== 0) {
        throw new Error(errorLine(result.stderr, result.code))
      }

      const file = finalPath && existsSync(finalPath) ? finalPath : this.findDownload(tmpDir, safe)
      if (!file) throw new Error('Downloaded file was not found')

      const ext = file.split('.').pop()?.toLowerCase() ?? 'm4a'
      const art = await fetchArt(job.track.thumbnail, this.store)
      const current = this.store.job(id)
      this.store.put(job.track, file, ext, current?.sources ?? job.sources, job.quality, art ?? undefined)
      this.progress.delete(id)
      this.opts.onCompleted(id)
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
        this.store.setJobState(id, 'failed', { error: message })
      }
      this.publish()
    } finally {
      this.estimateReported.delete(id)
      if (tmpDir) {
        // Keep a partial when the job is paused or queued for a retry; it is the
        // resume point. Finished, cancelled and permanently failed jobs clean up.
        const state = this.store.job(id)?.state
        if (state !== 'paused' && state !== 'queued') {
          rmSync(tmpDir, { recursive: true, force: true })
        }
      }
      this.active = null
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
    const busy = this.active !== null || this.queue.length > 0
    if (busy === this.busy) return
    this.busy = busy
    this.opts.onBusy(busy)
  }
}

export type { DownloadJob }
