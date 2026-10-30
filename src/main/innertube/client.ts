import type { BrowseHeader, BrowseResult, CatalogItem, MoodCategory, Shelf } from '@shared/types'
import { normalizeEntityName, pickAudioTrack, primaryArtistName } from '@shared/entity-identity'
import { INNERTUBE, SEARCH_FILTERS, type SearchFilter } from './constants'
import {
  continuationToken,
  dedupeTracks,
  extractHeader,
  extractItems,
  extractMoodCategories,
  extractShelves
} from './parse'

/**
 * Catalog access (PLAN §3). Search and browse answer in under a second, so the
 * UI never waits on yt-dlp just to *show* music — yt-dlp is only involved when
 * something is actually played.
 */

const REQUEST_TIMEOUT_MS = 10_000

/**
 * YouTube's anonymous visitor id. Most requests work without it, but a
 * discography continuation answers "Something went wrong" unless the visitor
 * that received the first page sends the next one.
 */
let visitorData: string | undefined

function context(): Record<string, unknown> {
  return {
    client: {
      clientName: INNERTUBE.clientName,
      clientVersion: INNERTUBE.clientVersion,
      hl: INNERTUBE.hl,
      gl: INNERTUBE.gl,
      ...(visitorData ? { visitorData } : {})
    }
  }
}

function rememberVisitor(response: unknown): void {
  const context = (response as { responseContext?: { visitorData?: unknown } } | null)
    ?.responseContext
  if (typeof context?.visitorData === 'string' && context.visitorData) {
    visitorData = context.visitorData
  }
}

async function call(
  endpoint: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<unknown> {
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
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  if (!res.ok) {
    throw new Error(`YouTube Music returned HTTP ${res.status}`)
  }
  const data: unknown = await res.json()
  rememberVisitor(data)
  return data
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
const artistImageCache = new Map<string, string | null>()
let moodCategoryCache: MoodCategory[] | null = null

/**
 * The mood/genre tiles are stable for a session and every Home visit asks for
 * them, so fetch them once. A failed request is not cached.
 */
export async function moodCategories(): Promise<MoodCategory[]> {
  if (moodCategoryCache) return moodCategoryCache
  const response = await call('browse', { browseId: 'FEmusic_moods_and_genres' })
  const categories = extractMoodCategories(response)
  if (categories.length > 0) moodCategoryCache = categories
  return categories
}

/**
 * Artist search cards carry a square artist portrait; history only stores the
 * album cover of the played track. Resolve the portrait once per artist and keep
 * the lookup bounded for the session.
 */
export async function artistImage(
  artistId: string | undefined,
  name: string
): Promise<string | null> {
  const key = artistId || name.trim().toLowerCase()
  if (artistImageCache.has(key)) return artistImageCache.get(key) ?? null

  const wanted = name.trim().toLowerCase()
  const results = (await search(name, 'artists')).filter(
    (item) => item.kind === 'artist' && (item.browseId || item.id)
  )
  const match =
    (artistId
      ? results.find((item) => item.browseId === artistId || item.id === artistId)
      : undefined) ??
    results.find((item) => item.title.trim().toLowerCase() === wanted) ??
    results[0]
  const image = match?.thumbnail ?? null

  if (artistImageCache.size > 200) artistImageCache.clear()
  artistImageCache.set(key, image)
  return image
}

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
  // The same video can be requested with or without credits. Cache per artist
  // too, so an unknown-artist refusal cannot poison the credited lookup.
  const cacheKey = `${videoId}|${normalizeEntityName(primaryArtistName(artist))}`
  if (audioTrackCache.has(cacheKey)) return audioTrackCache.get(cacheKey) ?? null

  const base = normalizeTitle(title)
  if (!base) return null

  const primaryArtist = artist.split(',')[0]?.trim() ?? ''
  const query = `${base} ${primaryArtist}`.trim()
  const results = (await search(query, 'songs')).filter((item) => item.videoType !== 'ugc')
  const candidate = pickAudioTrack(results, title, artist)

  if (audioTrackCache.size > 300) audioTrackCache.clear()
  audioTrackCache.set(cacheKey, candidate)
  return candidate
}

/** Identity of a catalog row, used to merge pages without duplicating items. */
function itemKey(item: CatalogItem): string {
  return `${item.kind}:${item.id ?? item.browseId ?? item.title}`
}

/**
 * Every item on a discography page, following YouTube's 100-release pages. A
 * prolific artist (Gucci Mane has 137 singles) is otherwise cut off at the
 * first page, which is the same class of bug as the ten-card preview.
 */
async function discographyItems(response: unknown): Promise<CatalogItem[]> {
  const items = extractItems(response)
  const seen = new Set(items.map(itemKey))
  let token = continuationToken(response)
  let pages = 0

  while (token && items.length < 10_000 && pages < 100) {
    const page = await call('browse', { continuation: token })
    for (const item of extractItems(page)) {
      const key = itemKey(item)
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
    token = continuationToken(page)
    pages++
    if (token) await new Promise((resolve) => setTimeout(resolve, 120))
  }

  return items
}

/**
 * Artist pages preview a discography: Albums and Singles & EPs stop at ten
 * cards, and YouTube hides the complete list behind each shelf's "More"
 * endpoint. Without following it, an artist with 44 releases appeared to have
 * ten — "Sociopath" was simply never requested. Only discography endpoints are
 * followed: Videos and Live performances use the same button for pages that
 * belong on YouTube, not in the discography.
 */
async function expandDiscography(shelves: Shelf[]): Promise<void> {
  const targets = shelves.filter(
    (shelf) => shelf.more?.pageType === 'MUSIC_PAGE_TYPE_ARTIST_DISCOGRAPHY'
  )

  await Promise.all(
    targets.map(async (shelf) => {
      const more = shelf.more
      if (!more) return
      try {
        const response = await call('browse', {
          browseId: more.browseId,
          ...(more.params ? { params: more.params } : {})
        })
        const complete = await discographyItems(response)
        if (complete.length === 0) return

        // The full list is newest-first and normally repeats the preview. Keep
        // any preview card it did not repeat so a quirk cannot lose a release.
        const seen = new Set(complete.map(itemKey))
        for (const item of shelf.items) {
          const key = itemKey(item)
          if (seen.has(key)) continue
          seen.add(key)
          complete.push(item)
        }
        shelf.items = complete
      } catch {
        // A failed "More" must not take down the artist page: the ten-card
        // preview YouTube already returned is still better than nothing.
      }
    })
  )
}

/** Open an album, artist, or playlist page: its own header plus its contents. */
export async function browse(browseId: string, params?: string): Promise<BrowseResult> {
  if (!browseId) throw new Error('Nothing to open')
  const first = await call('browse', params ? { browseId, params } : { browseId })
  const header = extractHeader(first)
  const items = extractItems(first)
  const seen = new Set(items.map(itemKey))
  const shelves = extractShelves(first).filter((shelf) => shelf.items.length > 0)
  const shelfIndex = new Map(shelves.map((shelf) => [shelf.title, shelf]))

  // Top songs can carry the same song as audio and as a video. The audio row is
  // the one Viby plays, so show it once.
  for (const shelf of shelves) {
    if (/top songs/i.test(shelf.title)) shelf.items = dedupeTracks(shelf.items)
  }

  // Artist pages need this before the renderer sees them, so counts and the
  // release rails are complete on the first paint.
  await expandDiscography(shelves)

  let token = continuationToken(first)
  let pages = 0

  // Albums and artist discographies paginate exactly like playlists. Without
  // this, a 200-track album silently ended after its first 100 rows.
  while (token && items.length < 10_000 && pages < 100) {
    const page = await call('browse', { continuation: token })
    for (const item of extractItems(page)) {
      const key = itemKey(item)
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
    for (const shelf of extractShelves(page)) {
      if (shelf.items.length === 0) continue
      const existing = shelfIndex.get(shelf.title)
      if (!existing) {
        shelfIndex.set(shelf.title, shelf)
        shelves.push(shelf)
        continue
      }
      const known = new Set(existing.items.map(itemKey))
      for (const item of shelf.items) {
        const key = itemKey(item)
        if (!known.has(key)) {
          known.add(key)
          existing.items.push(item)
        }
      }
    }
    token = continuationToken(page)
    pages++
    if (token) await new Promise((resolve) => setTimeout(resolve, 120))
  }

  return {
    // A release page is one track list: drop the music-video twin of a song
    // that is already present as official audio. Playlists keep their order
    // and contents untouched.
    items: header?.releaseType ? dedupeTracks(items) : items,
    header,
    shelves: shelves.length > 0 ? shelves : undefined
  }
}

/**
 * Every track in a playlist page, following YouTube Music's 100-row
 * continuations. Browse alone only returns the first page.
 */
export async function playlistItems(
  browseId: string,
  signal?: AbortSignal
): Promise<{ items: CatalogItem[]; header?: BrowseHeader }> {
  if (!browseId) throw new Error('Nothing to open')

  const first = await call('browse', { browseId })
  const header = extractHeader(first)
  const items = extractItems(first)
  const seen = new Set(items.map((item) => item.id))
  let token = continuationToken(first)
  let pages = 0

  while (token && items.length < 10_000 && pages < 100) {
    const page = await call('browse', { continuation: token }, signal)
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
