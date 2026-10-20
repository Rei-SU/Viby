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

export async function getLyrics(query: LyricsQuery): Promise<Lyrics> {
  const cached = lyricsStore().get()[query.trackId]
  if (cached) {
    const stale = cached.kind === 'none' && Date.now() - cached.fetchedAt > MISS_TTL
    if (!stale) return strip(cached)
  }

  const found = (await lookup(query)) ?? { kind: 'none' as const }
  save(query.trackId, found)
  return found
}

async function lookup(query: LyricsQuery): Promise<Lyrics | null> {
  const artist = primaryArtist(query.artist)
  if (!query.title.trim()) return null

  const exact = await request('get', {
    artist_name: artist,
    track_name: query.title,
    album_name: query.album ?? '',
    duration: query.durationSec > 0 ? String(Math.round(query.durationSec)) : ''
  })
  const fromExact = toLyrics(exact)
  if (fromExact) return fromExact

  // Exact lookup is fussy about titles ("Radio Edit", "feat. …"); search is not.
  const results = await request('search', {
    track_name: cleanTitle(query.title),
    artist_name: artist
  })
  const fromSearch = Array.isArray(results) ? toLyrics(pickBest(results, query)) : null
  if (fromSearch) return fromSearch

  // Backup source: plain text only, but better than "no lyrics".
  return fetchOvhLyrics(artist, query.title)
}

/**
 * lyrics.ovh — keyless, plain text. No timestamps, so it is only used when
 * LRCLIB has nothing at all.
 */
export async function fetchOvhLyrics(artist: string, title: string): Promise<Lyrics | null> {
  if (!artist.trim() || !title.trim()) return null

  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(cleanTitle(title))}`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return null

    const data = (await res.json()) as { lyrics?: string }
    const text = data.lyrics?.replace(/\r\n/g, '\n').trim()
    if (!text) return null

    return { kind: 'plain', plain: text, source: 'lyrics.ovh' }
  } catch {
    return null
  }
}

async function request(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${BASE}/${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value)
  }

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    // Offline or slow: no lyrics is a valid outcome, not an error.
    return null
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

/** Prefer a synced result whose duration matches the track. */
function pickBest(results: unknown[], query: LyricsQuery): unknown {
  const scored = results
    .filter((item): item is LrclibRecord => Boolean(item) && typeof item === 'object')
    .filter((item) => item.syncedLyrics || item.plainLyrics || item.instrumental)
    .map((item) => {
      const duration = Number(item.duration) || 0
      const drift =
        query.durationSec > 0 && duration > 0 ? Math.abs(duration - query.durationSec) : 30
      const syncPenalty = item.syncedLyrics ? 0 : 3
      return { item, score: drift + syncPenalty }
    })
    .sort((a, b) => a.score - b.score)

  return scored[0]?.item ?? null
}

function primaryArtist(artist: string): string {
  return artist.split(/[,&]|\sfeat\.?\s|\sx\s/i)[0]?.trim() ?? artist.trim()
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
