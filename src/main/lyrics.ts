import { JsonStore, userDataFile } from './json-store'
import type { Lyrics, LyricsLine } from '@shared/types'

/**
 * Lyrics, resolved from LRCLIB first (PLAN §5.5) because it is the only keyless
 * source with reliable *time-synced* lyrics for music. When LRCLIB has nothing,
 * lyrics.ovh is tried as a plain-text backup — "no lyrics" is only reported when
 * both come back empty. Results are cached on disk, including misses, so a
 * track is never looked up twice.
 */

const BASE = 'https://lrclib.net/api'
const USER_AGENT = 'Viby/0.1 (https://github.com/viby-app)'
const MAX_ENTRIES = 300
const MISS_TTL = 24 * 60 * 60 * 1000

type CachedLyrics = Lyrics & { fetchedAt: number }

let store: JsonStore<Record<string, CachedLyrics>> | null = null

function lyricsStore(): JsonStore<Record<string, CachedLyrics>> {
  if (!store) store = new JsonStore<Record<string, CachedLyrics>>(userDataFile('lyrics.json'), {})
  return store
}

export type LyricsQuery = {
  trackId: string
  title: string
  artist: string
  durationSec: number
  album?: string
}

const inflight = new Map<string, Promise<Lyrics>>()

export function getLyrics(query: LyricsQuery): Promise<Lyrics> {
  const cached = cachedLyrics(query.trackId)
  if (cached) return Promise.resolve(cached)

  // The player and the download backfill can ask for the same track at once.
  // Share the request so a slow failure cannot race a successful cache write.
  const existing = inflight.get(query.trackId)
  if (existing) return existing

  const request = loadLyrics(query).finally(() => {
    inflight.delete(query.trackId)
  })
  inflight.set(query.trackId, request)
  return request
}

async function loadLyrics(query: LyricsQuery): Promise<Lyrics> {
  const found = (await lookup(query)) ?? { kind: 'none' as const }
  save(query.trackId, found)
  return found
}

/**
 * The persisted result for a track, without touching the network. Downloaded
 * songs use this while offline; a stale "no lyrics" miss is treated as absent so
 * a later online lookup can try again.
 */
export function cachedLyrics(trackId: string): Lyrics | null {
  const cached = lyricsStore().get()[trackId]
  if (!cached) return null
  const stale = cached.kind === 'none' && Date.now() - cached.fetchedAt > MISS_TTL
  return stale ? null : strip(cached)
}

async function lookup(query: LyricsQuery): Promise<Lyrics | null> {
  const artist = primaryArtist(query.artist)
  if (!query.title.trim()) return null

  let transient = false
  const exact = await request('get', {
    artist_name: artist,
    track_name: query.title,
    album_name: query.album ?? '',
    duration: query.durationSec > 0 ? String(Math.round(query.durationSec)) : ''
  })
  transient ||= exact.transient
  const fromExact = toLyrics(exact.data)
  if (fromExact) return fromExact

  // Exact lookup is fussy about titles ("Radio Edit", "feat. …"); search is not.
  const results = await request('search', {
    track_name: cleanTitle(query.title),
    artist_name: artist
  })
  transient ||= results.transient
  const fromSearch = Array.isArray(results.data)
    ? toLyrics(pickBest(results.data, query))
    : null
  if (fromSearch) return fromSearch

  // Backup source: plain text only, but better than "no lyrics".
  const backup = await ovhLookup(artist, query.title)
  transient ||= backup.transient
  if (backup.lyrics) return backup.lyrics

  if (transient) {
    // Do not persist a 24-hour miss because a service was briefly unavailable.
    throw new Error('Lyrics service could not be reached. Try again in a moment.')
  }
  return null
}

/**
 * lyrics.ovh — keyless, plain text. No timestamps, so it is only used when
 * LRCLIB has nothing at all.
 */
async function ovhLookup(
  artist: string,
  title: string
): Promise<{ lyrics: Lyrics | null; transient: boolean }> {
  if (!artist.trim() || !title.trim()) return { lyrics: null, transient: false }

  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(cleanTitle(title))}`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    })
    if (res.status === 404) return { lyrics: null, transient: false }
    if (!res.ok) return { lyrics: null, transient: true }

    const data = (await res.json()) as { lyrics?: string }
    const text = data.lyrics?.replace(/\r\n/g, '\n').trim()
    if (!text) return { lyrics: null, transient: false }

    return { lyrics: { kind: 'plain', plain: text, source: 'lyrics.ovh' }, transient: false }
  } catch {
    return { lyrics: null, transient: true }
  }
}

/** Backwards-compatible plain-text lookup for callers that only want a result. */
export async function fetchOvhLyrics(artist: string, title: string): Promise<Lyrics | null> {
  return (await ovhLookup(artist, title)).lyrics
}

type RequestResult = { data: unknown; transient: boolean }

async function request(path: string, params: Record<string, string>): Promise<RequestResult> {
  const url = new URL(`${BASE}/${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value)
  }

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    })
    // 404/400 are definitive "not found"; 429 and 5xx are transient.
    if (res.status === 404 || res.status === 400) return { data: null, transient: false }
    if (!res.ok) return { data: null, transient: true }
    return { data: await res.json(), transient: false }
  } catch {
    // Offline, timeout, DNS failure, or malformed JSON. Do not cache this as a
    // permanent miss; the renderer can offer a retry instead.
    return { data: null, transient: true }
  }
}

type LrclibRecord = {
  trackName?: string
  artistName?: string
  duration?: number
  instrumental?: boolean
  plainLyrics?: string
  syncedLyrics?: string
}

function toLyrics(record: unknown): Lyrics | null {
  if (!record || typeof record !== 'object') return null
  const data = record as LrclibRecord

  if (data.instrumental === true) return { kind: 'instrumental', source: 'LRCLIB' }

  const lines = typeof data.syncedLyrics === 'string' ? parseLrc(data.syncedLyrics) : []
  if (lines.length > 0) {
    return { kind: 'synced', lines, plain: data.plainLyrics, source: 'LRCLIB' }
  }

  if (typeof data.plainLyrics === 'string' && data.plainLyrics.trim()) {
    return { kind: 'plain', plain: data.plainLyrics.trim(), source: 'LRCLIB' }
  }

  return null
}

/** LRC: `[mm:ss.xx] line`, sometimes several timestamps on one line. */
function parseLrc(text: string): LyricsLine[] {
  const lines: LyricsLine[] = []

  for (const raw of text.split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g)]
    if (stamps.length === 0) continue

    const content = raw.replace(/\[[^\]]*\]/g, '').trim()
    if (!content) continue

    for (const stamp of stamps) {
      lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]), text: content })
    }
  }

  return lines.sort((a, b) => a.time - b.time)
}

/** Prefer a synced result whose title, artist and duration match the track. */
function pickBest(results: unknown[], query: LyricsQuery): unknown {
  const wantedTitle = comparisonText(cleanTitle(query.title))
  const wantedArtist = comparisonText(query.artist)

  const scored = results
    .filter((item): item is LrclibRecord => Boolean(item) && typeof item === 'object')
    .filter((item) => item.syncedLyrics || item.plainLyrics || item.instrumental)
    .map((item) => {
      const title = comparisonText(cleanTitle(String(item.trackName ?? '')))
      const artist = comparisonText(String(item.artistName ?? ''))
      // A different title is almost always a cover, live version or remix.
      // Reject it rather than showing confidently wrong lyrics.
      const titleScore =
        wantedTitle && title
          ? title === wantedTitle
            ? 0
            : title.includes(wantedTitle) || wantedTitle.includes(title)
              ? 2
              : 20
          : 5
      const artistScore =
        wantedArtist && artist
          ? artist === wantedArtist
            ? 0
            : artist.includes(wantedArtist) || wantedArtist.includes(artist)
              ? 2
              : 8
          : 3
      const duration = Number(item.duration) || 0
      const drift =
        query.durationSec > 0 && duration > 0 ? Math.abs(duration - query.durationSec) : 8
      const syncPenalty = item.syncedLyrics ? 0 : 3
      return { item, score: titleScore * 12 + artistScore * 4 + Math.min(drift, 30) + syncPenalty }
    })
    .filter(({ score }) => score < 20 * 12)
    .sort((a, b) => a.score - b.score)

  return scored[0]?.item ?? null
}

function comparisonText(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\b(?:feat|ft|with)\b.*$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function primaryArtist(artist: string): string {
  // Only an explicit feature marker is a safe split. Splitting on `&` or every
  // comma broke names like "Simon & Garfunkel" and "Tyler, The Creator".
  const explicit = artist.split(/\s(?:feat\.?|ft\.?|with)\s/i)[0]?.trim() ?? artist.trim()
  const parts = explicit.split(',').map((part) => part.trim())
  // "Daft Punk, Julian Casablancas" is a main artist plus a feature;
  // "Tyler, The Creator" and "Earth, Wind & Fire" are single names.
  if (parts.length === 2 && !/^the\b/i.test(parts[1]) && /\s/.test(parts[1])) {
    return parts[0]
  }
  return explicit
}

function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([][^)\]]*(?:feat\.?|ft\.?|with)[^)\]]*[)\]]/gi, '')
    .replace(/\s*[([][^)\]]*(?:remaster(?:ed)?|version|edit)[^)\]]*[)\]]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function save(trackId: string, lyrics: Lyrics): void {
  lyricsStore().update((data) => {
    data[trackId] = { ...lyrics, fetchedAt: Date.now() }

    const entries = Object.entries(data)
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)
      for (const [key] of entries.slice(0, entries.length - MAX_ENTRIES)) delete data[key]
    }
  })
}

function strip(cached: CachedLyrics): Lyrics {
  const { fetchedAt: _fetchedAt, ...lyrics } = cached
  return lyrics
}
