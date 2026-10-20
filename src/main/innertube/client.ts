import type { BrowseHeader, BrowseResult, CatalogItem, Shelf } from '@shared/types'
import { INNERTUBE, SEARCH_FILTERS, type SearchFilter } from './constants'
import { continuationToken, extractHeader, extractItems, extractShelves } from './parse'

/**
 * Catalog access (PLAN §3). Search and browse answer in under a second, so the
 * UI never waits on yt-dlp just to *show* music — yt-dlp is only involved when
 * something is actually played.
 */

const REQUEST_TIMEOUT_MS = 10_000

function context(): Record<string, unknown> {
  return {
    client: {
      clientName: INNERTUBE.clientName,
      clientVersion: INNERTUBE.clientVersion,
      hl: INNERTUBE.hl,
      gl: INNERTUBE.gl
    }
  }
}

async function call(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const url = `${INNERTUBE.endpoint}/${endpoint}?prettyPrint=false&key=${INNERTUBE.apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': INNERTUBE.userAgent,
      Origin: INNERTUBE.origin,
      'X-Goog-Api-Format-Version': '1'
    },
    body: JSON.stringify({ context: context(), ...body }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  if (!res.ok) {
    throw new Error(`YouTube Music returned HTTP ${res.status}`)
  }
  return res.json()
}

export async function search(query: string, filter: SearchFilter = 'all'): Promise<CatalogItem[]> {
  const params = SEARCH_FILTERS[filter]
  const response = await call('search', params ? { query, params } : { query })
  return rankForSearch(extractItems(response))
}

/**
 * Search mixes entity types *and* release kinds. Official audio (ATV) comes
 * first, then unclassified songs, then music videos, then user uploads — so a
 * search for a song gives you the track, not somebody's video.
 */
function rankForSearch(items: CatalogItem[]): CatalogItem[] {
  const weight = (item: CatalogItem): number => {
    if (item.kind !== 'song') return 4
    if (item.videoType === 'audio') return 0
    if (item.videoType === 'ugc') return 3
    if (item.videoType === 'video') return 2
    return 1
  }
  return [...items].sort((a, b) => weight(a) - weight(b))
}

/** "Title (Official Video) [4K]" → "title" for matching. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\((?:official\s+)?(?:music\s+)?video\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s*(?:official|lyric)\s+video\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const audioTrackCache = new Map<string, CatalogItem | null>()

/**
 * Given a music video, find the released audio track for the same song. This is
 * what "prioritise audio" means in practice: play the ATV, not the video's
 * soundtrack (which may include intros, crowd noise or a different edit).
 */
export async function audioTrackFor(
  videoId: string,
  title: string,
  artist: string
): Promise<CatalogItem | null> {
  if (audioTrackCache.has(videoId)) return audioTrackCache.get(videoId) ?? null

  const base = normalizeTitle(title)
  if (!base) return null

  const query = `${base} ${artist.split(',')[0]?.trim() ?? ''}`.trim()
  const results = (await search(query, 'songs')).filter((item) => item.videoType !== 'ugc')

  const candidate =
    results.find((item) => {
      if (item.kind !== 'song' || !item.id) return false
      const name = normalizeTitle(item.title)
      if (!name) return false
      return name === base || name.startsWith(base) || base.startsWith(name)
    }) ?? null

  if (audioTrackCache.size > 300) audioTrackCache.clear()
  audioTrackCache.set(videoId, candidate)
  return candidate
}

/** Open an album, artist, or playlist page: its own header plus its contents. */
export async function browse(browseId: string): Promise<BrowseResult> {
  if (!browseId) throw new Error('Nothing to open')
  const response = await call('browse', { browseId })
  const shelves = extractShelves(response).filter((shelf) => shelf.items.length > 0)
  return {
    items: extractItems(response),
    header: extractHeader(response),
    shelves: shelves.length > 0 ? shelves : undefined
  }
}

/**
 * Every track in a playlist page, following YouTube Music's 100-row
 * continuations. Browse alone only returns the first page.
 */
export async function playlistItems(
  browseId: string
): Promise<{ items: CatalogItem[]; header?: BrowseHeader }> {
  if (!browseId) throw new Error('Nothing to open')

  const first = await call('browse', { browseId })
  const header = extractHeader(first)
  const items = extractItems(first)
  const seen = new Set(items.map((item) => item.id))
  let token = continuationToken(first)
  let pages = 0

  while (token && items.length < 10_000 && pages < 100) {
    const page = await call('browse', { continuation: token })
    for (const item of extractItems(page)) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      items.push(item)
    }
    token = continuationToken(page)
    pages++
    if (token) await new Promise((resolve) => setTimeout(resolve, 120))
  }

  return { items, header }
}

/**
 * YouTube Music's "Up next" radio for a track — the same queue the web player
 * builds. This is what autoplay continues with, so the next song is related
 * music instead of whatever happened to sit next in a search result list.
 */
/** Titles that are plainly a video upload rather than the released track. */
const VIDEO_TITLE =
  /(?:\(|\[)\s*(?:official\s+)?(?:music\s+)?video\s*(?:\)|\])|\bofficial\s+video\b|\blyric\s+video\b|\bvisuali[sz]er\b/i

export async function radio(videoId: string): Promise<CatalogItem[]> {
  if (!videoId) return []

  const response = await call('next', {
    videoId,
    playlistId: `RDAMVM${videoId}`,
    isAudioOnly: true
  })

  return extractItems(response).filter(
    (item) =>
      item.kind === 'song' &&
      Boolean(item.id) &&
      item.id !== videoId &&
      item.videoType !== 'ugc' &&
      !VIDEO_TITLE.test(item.title)
  )
}

/** Home shelves: moods, charts, and recommendations straight from YT Music. */
export async function home(): Promise<Shelf[]> {
  const response = await call('browse', { browseId: 'FEmusic_home' })
  return extractShelves(response)
}

export async function charts(): Promise<Shelf[]> {
  const response = await call('browse', { browseId: 'FEmusic_charts' })
  return extractShelves(response)
}
