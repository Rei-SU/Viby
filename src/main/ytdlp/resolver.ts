import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ResolveResult, StreamInfo, Track } from '@shared/types'
import { ensureRunner, pluginArgs, type Runner } from './binary'
import { run } from './exec'

/**
 * Stream resolution (PLAN §3, §7 R1).
 *
 * YouTube enforces PO tokens / SABR on stream URLs depending on the client, and
 * which clients work changes without notice. Measured on 2026-10-18: every
 * explicitly pinned client set (android_vr, tv, web, mweb, ios, web_safari)
 * returned SABR-only or failed outright, while yt-dlp's own default multi-client
 * selection returned five progressive HTTPS audio streams. So the default comes
 * first and pinning is only a last resort — the reverse of the original guess.
 */

/** `null` means "let yt-dlp choose", which is currently the only thing that works. */
const CLIENT_SETS: Array<string | null> = [null, 'ios,web_safari', 'web_safari,web']

const URL_TTL_MS = 2 * 60 * 60 * 1000

/** Keep the persisted cache bounded; expired entries are pruned on save. */
const URL_CACHE_LIMIT = 300

type ResolvedEntry = {
  result: ResolveResult
  expiresAt: number
}

export class Resolver {
  private semaphore = new Semaphore(2)
  /** Opportunistic caching must never occupy a slot a play request needs. */
  private backgroundSemaphore = new Semaphore(1)
  private urlCache = new Map<string, ResolvedEntry>()
  private cacheFile: string | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  /** Cheap check used to avoid prefetching something already warm. */
  hasCached(input: string, maxKbps?: number): boolean {
    const hit = this.urlCache.get(this.cacheKey(Resolver.normalizeInput(input), maxKbps))
    return Boolean(hit && hit.expiresAt > Date.now())
  }

  private cacheKey(url: string, maxKbps?: number): string {
    return maxKbps ? `${url}#${maxKbps}` : url
  }

  /** Quality changes invalidate stream URLs resolved under the old ceiling. */
  clearUrlCache(): void {
    this.urlCache.clear()
    this.persistNow()
  }

  /**
   * Stream URLs are IP-bound and expire, so they are cached for two hours. Doing
   * that on disk too means reopening the app does not make you wait again for
   * tracks you were just playing.
   */
  attachUrlCache(file: string): void {
    this.cacheFile = file
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, ResolvedEntry>
      const now = Date.now()
      for (const [url, entry] of Object.entries(raw)) {
        if (entry?.expiresAt > now && entry.result?.stream?.url) this.urlCache.set(url, entry)
      }
    } catch {
      // First run, or a corrupt file: nothing to restore.
    }

    // If URLs were already resolved in-memory before the cache was attached,
    // make sure they reach disk too.
    if (this.urlCache.size > 0) this.persistSoon()
  }

  private persistSoon(): void {
    if (!this.cacheFile || this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persistNow()
    }, 800)
  }

  private persistNow(): void {
    const file = this.cacheFile
    if (!file) return
    try {
      const now = Date.now()
      const entries = [...this.urlCache.entries()]
        .filter(([, entry]) => entry.expiresAt > now)
        .sort((a, b) => b[1].expiresAt - a[1].expiresAt)
        .slice(0, URL_CACHE_LIMIT)
      writeFileSync(`${file}.tmp`, JSON.stringify(Object.fromEntries(entries)))
      renameSync(`${file}.tmp`, file)
    } catch {
      // Persistence is a convenience; never fail playback over it.
    }
  }

  static normalizeInput(input: string): string {
    const trimmed = input.trim()
    if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
      return `https://music.youtube.com/watch?v=${trimmed}`
    }
    return trimmed
  }

  /** Best-effort video id, so we can check the audio cache before any network call. */
  static extractId(input: string): string | null {
    const trimmed = input.trim()
    if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed
    try {
      const url = new URL(trimmed)
      const v = url.searchParams.get('v')
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v
      const last = url.pathname.split('/').filter(Boolean).pop()
      if (last && /^[A-Za-z0-9_-]{11}$/.test(last)) return last
    } catch {
      return null
    }
    return null
  }

  async resolve(
    input: string,
    opts: { force?: boolean; signal?: AbortSignal; maxKbps?: number } = {}
  ): Promise<ResolveResult> {
    const url = Resolver.normalizeInput(input)
    if (!isSafeYtDlpInput(url)) {
      throw new ResolveError('unknown', 'Only http(s) track URLs are supported.')
    }

    // A playlist link is an import, not a playback target. Say so plainly instead
    // of letting yt-dlp fail in a way nobody can read.
    if (isPlaylistOnlyUrl(url)) {
      throw new ResolveError(
        'playlist',
        'That is a playlist link. Playlist import is coming — for now, open a single song.'
      )
    }

    const cacheKey = this.cacheKey(url, opts.maxKbps)
    if (!opts.force) {
      const hit = this.urlCache.get(cacheKey)
      if (hit && hit.expiresAt > Date.now()) return hit.result
    }

    return this.semaphore.run(async () => {
      const started = Date.now()
      const runner = await ensureRunner()
      let lastError: Error | null = null

      for (const clients of CLIENT_SETS) {
        if (opts.signal?.aborted) throw new ResolveError('cancelled', 'Cancelled.')

        try {
          const info = await this.inspect(runner, url, clients, opts.signal)
          const parsed = parseInfo(info, clients, opts.maxKbps)
          const result: ResolveResult = {
            ...parsed,
            client: clients ?? 'default',
            resolveMs: Date.now() - started
          }
          this.urlCache.set(cacheKey, { result, expiresAt: Date.now() + URL_TTL_MS })
          this.persistSoon()
          return result
        } catch (err) {
          // A cancel is a decision, not a failure — report it as such rather than
          // retrying the next client for a track nobody is waiting for.
          if (opts.signal?.aborted) throw new ResolveError('cancelled', 'Cancelled.')
          // Some failures are not client-specific, so retrying other clients just
          // burns another 30 seconds of the user's life for the same answer.
          if (err instanceof ResolveError && err.kind === 'unavailable') throw err
          if (err instanceof ResolveError && err.kind === 'cancelled') throw err
          if (err instanceof NoDirectUrlError) throw err
          lastError = err as Error
        }
      }

      throw lastError ?? new ResolveError('unknown', 'Could not resolve this track from YouTube.')
    })
  }

  private async inspect(
    runner: Runner,
    url: string,
    clients: string | null,
    signal?: AbortSignal
  ): Promise<YtDlpInfo> {
    const args = [
      '--no-playlist',
      '--no-warnings',
      '--skip-download',
      '--no-progress',
      '--no-simulate',
      '-J',
      ...(clients ? ['--extractor-args', `youtube:player_client=${clients}`] : []),
      ...pluginArgs(),
      '--',
      url
    ]

    const { code, stdout, stderr } = await run(
      runner.command,
      [...runner.prefix, ...args],
      { timeoutMs: 60_000, signal }
    )
    const trimmed = stdout.trim()

    // yt-dlp prints the literal string "null" to stdout and exits non-zero when
    // extraction fails. Treating that as data is exactly what produced
    // "Cannot read properties of null (reading 'id')" — and it threw away the
    // real reason, which was sitting in stderr the whole time.
    if (code !== 0 || !trimmed || trimmed === 'null') {
      throw describeFailure(stderr, code)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw describeFailure(stderr, code)
    }

    if (!isInfo(parsed)) throw describeFailure(stderr, code)
    return parsed
  }

  /** Download-to-cache, used when no directly playable URL exists. */
  async download(
    url: string,
    signal?: AbortSignal,
    maxKbps?: number,
    background = false
  ): Promise<{ file: string; ext: string; id: string; dir: string }> {
    if (!isSafeYtDlpInput(url)) throw new Error('Only http(s) track URLs are supported.')
    const semaphore = background ? this.backgroundSemaphore : this.semaphore
    return semaphore.run(async () => {
      const runner = await ensureRunner()
      const id = Resolver.extractId(url) ?? `viby-${Date.now()}`
      const dir = mkdtempSync(join(tmpdir(), 'viby-track-'))

      try {
        const { code, stderr } = await run(
          runner.command,
          [
            ...runner.prefix,
            '--no-playlist',
            '--no-warnings',
            '--no-progress',
            '-f',
            maxKbps ? `bestaudio[abr<=${maxKbps}]/bestaudio/best` : 'bestaudio/best',
            // No pinned clients: see the note on CLIENT_SETS — pinning currently
            // yields SABR-only formats, which cannot be downloaded either.
            ...pluginArgs(),
            '-o',
            join(dir, `${id}.%(ext)s`),
            '--',
            url
          ],
          { timeoutMs: 300_000, signal }
        )
        if (code !== 0) throw new Error(firstLine(stderr) || 'Download failed')

        const file = readdirSync(dir).find((f) => f.startsWith(id))
        if (!file) throw new Error('Downloaded file was not found')

        const ext = file.split('.').pop() ?? 'm4a'
        return { file: join(dir, file), ext, id, dir }
      } catch (err) {
        rmSync(dir, { recursive: true, force: true })
        throw err
      }
    })
  }

  invalidate(input: string): void {
    const url = Resolver.normalizeInput(input)
    for (const key of [...this.urlCache.keys()]) {
      if (key === url || key.startsWith(`${url}#`)) this.urlCache.delete(key)
    }
    this.persistSoon()
  }
}

type YtDlpInfo = {
  id: string
  title?: string
  track?: string
  artist?: string
  album?: string
  uploader?: string
  channel?: string
  duration?: number
  thumbnail?: string
  webpage_url?: string
  formats?: Array<FormatInfo & { url?: string }>
}

type FormatInfo = {
  format_id?: string
  ext?: string
  acodec?: string
  vcodec?: string
  abr?: number
  tbr?: number
  /** 'https' = progressive, 'm3u8_native'/'dash' = segmented (unplayable here). */
  protocol?: string
}

/**
 * Thrown when YouTube only hands back SABR/DASH fragments with no directly
 * playable URL. Carries the metadata so the caller can still download-to-cache
 * without re-resolving.
 */
export class NoDirectUrlError extends Error {
  constructor(readonly track: Track) {
    super('no-direct-url')
    this.name = 'NoDirectUrlError'
  }
}

/**
 * Prefer the highest-bitrate progressive audio format.
 *
 * Segmented formats (HLS/DASH) are deliberately rejected: Chromium — and so
 * Electron — cannot play HLS in an <audio> element, so handing one over would
 * look like a playback bug rather than a format problem. No progressive format
 * means NoDirectUrlError, which triggers download-to-cache instead.
 */
function parseInfo(
  info: YtDlpInfo,
  clients: string | null,
  maxKbps?: number
): Pick<ResolveResult, 'track' | 'stream'> {
  const track = parseTrack(info)

  const progressiveAudio = (info.formats ?? []).filter(
    (f) =>
      f.url &&
      (f.protocol === 'https' || f.protocol === 'http') &&
      f.vcodec === 'none' &&
      f.acodec &&
      f.acodec !== 'none'
  )

  // Data saver: stay under the ceiling. If nothing fits, take the lowest stream
  // rather than failing — never silently jump back to the highest bitrate.
  let candidates = progressiveAudio
  if (maxKbps) {
    const under = progressiveAudio.filter((f) => (f.abr ?? f.tbr ?? 0) <= maxKbps)
    candidates =
      under.length > 0
        ? under
        : [...progressiveAudio]
            .sort((a, b) => (a.abr ?? a.tbr ?? 0) - (b.abr ?? b.tbr ?? 0))
            .slice(0, 1)
  }

  const best = candidates.sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))[0]

  if (!best?.url) throw new NoDirectUrlError(track)

  return {
    track,
    stream: toStream(best.url, best.ext ?? 'm4a', best.abr)
  }
}

export function parseTrack(info: YtDlpInfo): Track {
  return {
    id: info.id,
    title: info.track ?? info.title ?? 'Unknown title',
    artist: info.artist ?? info.uploader ?? info.channel ?? 'Unknown artist',
    album: info.album,
    durationSec: Math.round(info.duration ?? 0),
    thumbnail: info.thumbnail,
    sourceUrl: info.webpage_url
  }
}

function toStream(url: string, ext: string, bitrateKbps: number | undefined): StreamInfo {
  return {
    url,
    kind: 'remote',
    ext,
    mime: mimeFor(ext),
    bitrateKbps: bitrateKbps ? Math.round(bitrateKbps) : undefined,
    expiresAt: Date.now() + URL_TTL_MS,
    cached: false
  }
}

function mimeFor(ext: string): string {
  switch (ext) {
    case 'webm':
      return 'audio/webm'
    case 'opus':
      return 'audio/ogg'
    case 'mp3':
      return 'audio/mpeg'
    case 'm4a':
    case 'mp4':
    default:
      return 'audio/mp4'
  }
}

function firstLine(text: string): string {
  return text.trim().split('\n').filter(Boolean).pop() ?? ''
}

export type ResolveErrorKind = 'unavailable' | 'playlist' | 'botcheck' | 'cancelled' | 'unknown'

/** A resolution failure with a message worth showing a human. */
/** yt-dlp treats a leading `-` as an option; never pass renderer strings as options. */
export function isSafeYtDlpInput(input: string): boolean {
  const value = input.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export class ResolveError extends Error {
  constructor(
    readonly kind: ResolveErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'ResolveError'
  }
}

/**
 * yt-dlp puts the actual reason in stderr; surface it instead of a generic
 * failure or, worse, a crash deep in a parser.
 */
function describeFailure(stderr: string, code: number): ResolveError {
  const text = stderr.toLowerCase()

  if (text.includes('sign in to confirm') || text.includes('not a bot')) {
    return new ResolveError(
      'botcheck',
      'YouTube is asking for a bot check. Try "Update resolver" below; if that does not help, the PO-token provider is needed.'
    )
  }
  if (text.includes('video is unavailable') || text.includes('this video is unavailable')) {
    return new ResolveError(
      'unavailable',
      'That track is unavailable — removed, private, or blocked in your region.'
    )
  }
  if (text.includes('does not exist')) {
    return new ResolveError('unavailable', 'That link does not exist.')
  }
  if (text.includes('private video')) {
    return new ResolveError('unavailable', 'That track is private.')
  }

  const line = lastErrorLine(stderr)
  return new ResolveError('unknown', line || `yt-dlp exited with code ${code}.`)
}

function lastErrorLine(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const error = [...lines].reverse().find((l) => l.startsWith('ERROR:'))
  return (error ?? lines.pop() ?? '').replace(/^ERROR:\s*/, '')
}

function isInfo(value: unknown): value is YtDlpInfo {
  return !!value && typeof value === 'object' && typeof (value as YtDlpInfo).id === 'string'
}

/** `playlist?list=X` is an import. `watch?v=X&list=Y` is a song and plays fine. */
function isPlaylistOnlyUrl(url: string): boolean {
  return /[?&]list=/.test(url) && !/[?&]v=/.test(url)
}

/** Caps concurrent yt-dlp children so we never fan out into a resource spike. */
class Semaphore {
  private active = 0
  private queue: Array<() => void> = []

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.queue.shift()?.()
    }
  }
}
