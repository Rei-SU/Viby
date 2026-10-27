import type { BrowseHeader, CatalogItem, CatalogKind, Shelf, SubtitlePart } from '@shared/types'

/**
 * Tolerant InnerTube response parsing.
 *
 * YouTube ships the same data in several containers depending on endpoint
 * (itemSectionRenderer, musicShelfRenderer, musicCardShelfRenderer) and renames
 * fields over time, so rather than hardcoding paths this walks the tree and picks
 * up any renderer it recognises. Pure functions, no Electron — which is what makes
 * them testable against real captured responses (tests/innertube.test.ts).
 */

type AnyObj = Record<string, any>

const TIME_RE = /^\d{1,2}:\d{2}(?::\d{2})?$/
const VIEWS_RE = /^[\d.,]+\s*[KMB]?\s*(?:plays|views)$/i

/**
 * The release label YouTube prints before the year ("Single • 2022"). Kept
 * verbatim: YouTube distinguishes Album, Single, EP, Audiobook and Compilation,
 * and a single shown as an album is simply wrong. Returns undefined when the
 * text is not a release line, so callers can omit the label instead of guessing.
 */
function releaseTypeOf(text: string): string | undefined {
  const match = /^(album|single|ep|compilation|audiobook)\b/i.exec(text.trim())
  return match ? match[0] : undefined
}

/** Separator-only subtitle fragments (" • ", ", ") carry no link. */
function isSeparator(part: SubtitlePart): boolean {
  return !part.artistId && !part.albumId && /^[\s,&•·|/+-]+$/.test(part.text)
}
const MAX_DEPTH = 16
const SKIP_KEYS = new Set(['trackingParams', 'responseContext'])

/** Flat list of everything playable/openable in a response. */
export function extractItems(response: unknown): CatalogItem[] {
  const found: CatalogItem[] = []
  walk(response, found, 0)

  const seen = new Set<string>()
  return found.filter((item) => {
    const key = `${item.kind}:${item.id}:${item.title}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * The first continuation token in a browse response. Playlist pages return one
 * per 100 rows; the import resolver follows them until the list is complete.
 */
export function continuationToken(response: unknown): string | null {
  let found: string | null = null

  const visit = (node: unknown, depth: number): void => {
    if (found || node == null || typeof node !== 'object' || depth > 20) return
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1)
      return
    }

    const object = node as Record<string, unknown>
    const command = object.continuationCommand as { token?: unknown } | undefined
    const legacy = object.nextContinuationData as { continuation?: unknown } | undefined
    const token = command?.token ?? legacy?.continuation
    if (typeof token === 'string' && token) {
      found = token
      return
    }

    for (const value of Object.values(object)) {
      if (value && typeof value === 'object') visit(value, depth + 1)
    }
  }

  visit(response, 0)
  return found
}

/** Home/browse responses group items into named shelves. */
export function extractShelves(response: unknown): Shelf[] {
  const shelves: Shelf[] = []
  collectShelves(response, shelves, 0)
  return shelves.filter((s) => s.items.length > 0)
}

const HEADER_KEYS = [
  'musicImmersiveHeaderRenderer',
  'musicResponsiveHeaderRenderer',
  'musicDetailHeaderRenderer',
  'musicVisualHeaderRenderer'
] as const

/**
 * Artist, album and playlist pages carry their own header (real artist photo,
 * album art, description). Without it the UI had to borrow the artwork of
 * whatever track linked here — which is why two different artists appeared to
 * have the same picture.
 */
export function extractHeader(response: unknown): BrowseHeader | undefined {
  for (const key of HEADER_KEYS) {
    const node = findByKey(response, key)
    if (!node) continue

    const thumbnails =
      node.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
      node.foregroundThumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
    const best = Array.isArray(thumbnails) ? thumbnails[thumbnails.length - 1]?.url : undefined

    const heading = textOf(node.title)
    if (!heading) continue

    const subtitle = textOf(node.subtitle) || textOf(node.description)
    const subtitleRuns = runsOf(node.subtitle)
    const artistRun = subtitleRuns.find((run) => refId(run, 'artist'))

    // Album and single headers credit the artist in `straplineTextOne` — the
    // line above the title — while the subtitle is only "Album • 2021". Read it
    // for releases so an album opened from anywhere (Home, a track's album
    // link, history) still knows its artist; otherwise every row fell back to
    // "Unknown artist". Playlists are excluded: their strapline, when present,
    // is the owner, not the artist.
    const releaseType = releaseTypeOf(subtitle)
    const creditedRun =
      artistRun ??
      (releaseType
        ? runsOf(node.straplineTextOne).find((run) => refId(run, 'artist'))
        : undefined)
    const artistId = creditedRun ? refId(creditedRun, 'artist') : undefined

    // "71.8M monthly audience" → "71.8M". Artists only; albums/playlists omit it.
    const monthlyText = textOf(node.monthlyListenerCount)
    const monthlyListeners = monthlyText
      ? monthlyText.replace(/\s+monthly.*$/i, '').trim() || undefined
      : undefined

    return {
      title: heading,
      subtitle: subtitle ? subtitle.slice(0, 200) : undefined,
      thumbnail: best,
      releaseType,
      monthlyListeners,
      artist:
        creditedRun && artistId
          ? { name: String(creditedRun.text ?? '').trim(), id: artistId }
          : undefined
    }
  }
  return undefined
}

function findByKey(node: unknown, key: string, depth = 0): AnyObj | null {
  if (node == null || depth > 20) return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByKey(child, key, depth + 1)
      if (hit) return hit
    }
    return null
  }
  if (typeof node !== 'object') return null

  const obj = node as AnyObj
  if (obj[key] && typeof obj[key] === 'object') return obj[key] as AnyObj

  for (const child of Object.values(obj)) {
    const hit = findByKey(child, key, depth + 1)
    if (hit) return hit
  }
  return null
}

function collectShelves(node: unknown, out: Shelf[], depth: number): void {
  if (node == null || depth > MAX_DEPTH) return
  if (Array.isArray(node)) {
    for (const child of node) collectShelves(child, out, depth + 1)
    return
  }
  if (typeof node !== 'object') return

  const obj = node as AnyObj

  const carousel = obj.musicCarouselShelfRenderer
  if (carousel) {
    const header = carousel.header?.musicCarouselShelfBasicHeaderRenderer
    out.push({
      title: textOf(header?.title),
      items: extractItems(carousel.contents),
      more: shelfMore(header)
    })
    return
  }

  const shelf = obj.musicShelfRenderer
  if (shelf) {
    out.push({
      title: textOf(shelf.title) || textOf(shelf.header),
      items: extractItems(shelf.contents),
      more: shelfMore(shelf.header?.musicShelfBasicHeaderRenderer ?? shelf.header)
    })
    return
  }

  const card = obj.musicCardShelfRenderer
  if (card) {
    out.push({
      title: textOf(card.title) || textOf(card.header),
      items: extractItems(card.contents)
    })
    return
  }

  for (const key of Object.keys(obj)) {
    if (SKIP_KEYS.has(key)) continue
    collectShelves(obj[key], out, depth + 1)
  }
}

/**
 * A shelf header's "More" button, when YouTube offers one. The page type tells
 * us where it leads: artist discographies are worth following, while the same
 * shape also targets videos and live performances, which are not.
 */
function shelfMore(header: AnyObj | undefined): Shelf['more'] {
  const browse = header?.moreContentButton?.buttonRenderer?.navigationEndpoint?.browseEndpoint
  if (!browse?.browseId) return undefined

  return {
    browseId: browse.browseId,
    params: browse.params,
    pageType:
      browse.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType
  }
}

function walk(node: unknown, out: CatalogItem[], depth: number): void {
  if (node == null || depth > MAX_DEPTH) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out, depth + 1)
    return
  }
  if (typeof node !== 'object') return

  const obj = node as AnyObj

  if (obj.musicResponsiveListItemRenderer) {
    const item = fromResponsiveListItem(obj.musicResponsiveListItemRenderer)
    if (item) out.push(item)
    return
  }
  if (obj.musicTwoRowItemRenderer) {
    const item = fromTwoRowItem(obj.musicTwoRowItemRenderer)
    if (item) out.push(item)
    return
  }
  if (obj.playlistPanelVideoRenderer) {
    const item = fromPlaylistPanelVideo(obj.playlistPanelVideoRenderer)
    if (item) out.push(item)
    return
  }

  for (const key of Object.keys(obj)) {
    if (SKIP_KEYS.has(key)) continue
    walk(obj[key], out, depth + 1)
  }
}

function fromResponsiveListItem(renderer: AnyObj): CatalogItem | null {
  const columns = (renderer.flexColumns ?? []).map(
    (c: AnyObj) => c.musicResponsiveListItemFlexColumnRenderer?.text
  )

  const title = textOf(columns[0])
  if (!title) return null

  const subtitleNode = columns[1]
  const subtitle = textOf(subtitleNode)
  const subtitleRuns = runsOf(subtitleNode)

  const timeRun = [...subtitleRuns]
    .reverse()
    .find((run) => TIME_RE.test(String(run.text ?? '').trim()))
  const timeText =
    (timeRun ? String(timeRun.text).trim() : '') ||
    textOf(renderer.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text)

  const viewsRun = subtitleRuns.find((run) => VIEWS_RE.test(String(run.text ?? '').trim()))

  const videoId =
    renderer.playlistItemData?.videoId ??
    renderer.navigationEndpoint?.watchEndpoint?.videoId ??
    renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.videoId ??
    subtitleRuns.find((r) => r.navigationEndpoint?.watchEndpoint?.videoId)?.navigationEndpoint
      ?.watchEndpoint?.videoId ??
    ''

  const browseId =
    renderer.navigationEndpoint?.browseEndpoint?.browseId ??
    subtitleRuns.find((r) => r.navigationEndpoint?.browseEndpoint?.browseId)?.navigationEndpoint
      ?.browseEndpoint?.browseId ??
    ''

  const pageKind = kindFromPageType(pageTypeOf(renderer) ?? pageTypeOf(subtitleRuns[0]))
  // Profiles and podcasts carry no page type, yet they open fine; labelling them
  // "unknown" made the row tag wrong and the click ambiguous.
  const kind: CatalogKind = videoId
    ? 'song'
    : pageKind !== 'unknown'
      ? pageKind
      : kindFromSubtitle(subtitle)

  // Split the subtitle into parts so the UI can make artist and album names
  // clickable without re-parsing strings. The duration and play count are shown
  // in dedicated slots, so they are removed here rather than duplicated.
  const parts = partsFrom(subtitleRuns.filter((run) => run !== timeRun && run !== viewsRun))
  while (parts.length > 0 && isSeparator(parts[parts.length - 1])) parts.pop()

  // Artist pages add extra columns: play count and the album the song belongs to.
  let extraViews: string | undefined
  for (const column of columns.slice(2)) {
    const text = textOf(column)
    if (!text) continue
    if (VIEWS_RE.test(text.trim())) {
      extraViews = text.trim()
      continue
    }
    const albumRun = runsOf(column).find((run) => refId(run, 'album'))
    if (albumRun) {
      if (parts.length > 0) parts.push({ text: ' · ' })
      parts.push({ text: text.trim(), albumId: refId(albumRun, 'album'), entity: 'album' })
    }
  }

  const views = viewsRun ? String(viewsRun.text).trim() : extraViews
  const artists = parts
    .filter((part) => part.artistId)
    .map((part) => part.text.trim())
    .filter(Boolean)

  return {
    id: videoId || browseId,
    browseId: browseId || undefined,
    kind,
    releaseType: kind === 'album' ? releaseTypeOf(subtitle) : undefined,
    title,
    subtitle,
    parts: parts.length ? parts : undefined,
    thumbnail: bestThumbnail(renderer),
    durationSec: parseDuration(timeText ?? ''),
    artists: artists.length ? artists : undefined,
    views,
    videoType: videoTypeOf(renderer)
  }
}

function fromTwoRowItem(renderer: AnyObj): CatalogItem | null {
  const title = textOf(renderer.title)
  if (!title) return null

  // Video cards (artist pages, "Videos" carousels) carry a watch endpoint, not a
  // browse endpoint. Reading only browseEndpoint left those whole carousels dead:
  // no id, so the row was neither playable nor openable.
  const videoId =
    renderer.navigationEndpoint?.watchEndpoint?.videoId ??
    renderer.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.videoId ??
    ''

  const browseId = renderer.navigationEndpoint?.browseEndpoint?.browseId ?? ''
  const subtitle = textOf(renderer.subtitle)
  const pageKind = kindFromPageType(pageTypeOf(renderer))
  const parts = partsFrom(runsOf(renderer.subtitle))
  const kind: CatalogKind =
    videoId ? 'song' : pageKind !== 'unknown' ? pageKind : kindFromSubtitle(subtitle)

  return {
    id: videoId || browseId,
    browseId: browseId || undefined,
    kind,
    releaseType: kind === 'album' ? releaseTypeOf(subtitle) : undefined,
    title,
    subtitle,
    parts: parts.length ? parts : undefined,
    thumbnail: bestThumbnail(renderer),
    videoType: videoTypeOf(renderer)
  }
}

/**
 * Radio / "Up next" queues come back as `playlistPanelVideoRenderer` rather than
 * the search-list renderers. Same information, different shape.
 */
function fromPlaylistPanelVideo(renderer: AnyObj): CatalogItem | null {
  const videoId: string | undefined = renderer.videoId
  const title = textOf(renderer.title)
  if (!videoId || !title) return null

  const bylineRuns = runsOf(renderer.longBylineText)
  const viewsRun = bylineRuns.find((run) => VIEWS_RE.test(String(run.text ?? '').trim()))

  // A radio byline is "Artist • 1.8B views • 19M likes". Keep the artist links,
  // drop the counters (views gets its own slot, likes is noise here).
  const parts = partsFrom(bylineRuns).filter(
    (part) => part.artistId || isSeparator(part)
  )
  while (parts.length > 0 && isSeparator(parts[parts.length - 1])) parts.pop()

  const artists = parts
    .filter((part) => part.artistId)
    .map((part) => part.text.trim())
    .filter(Boolean)

  return {
    id: videoId,
    kind: 'song',
    title,
    subtitle: textOf(renderer.longBylineText),
    parts: parts.length ? parts : undefined,
    thumbnail: bestThumbnail(renderer),
    durationSec: parseDuration(textOf(renderer.lengthText) ?? ''),
    artists: artists.length ? artists : undefined,
    views: viewsRun ? String(viewsRun.text).trim() : undefined
  }
}

/**
 * A run's navigation target, by kind.
 *
 * Search rows label their links with `pageType`, but Home carousels and radio
 * bylines often omit it. The id prefix is stable (`UC…` artist, `MPREb_…` album),
 * so fall back to that instead of silently dropping the link.
 */
function refId(run: AnyObj, kind: 'artist' | 'album'): string | undefined {
  const browseId: string | undefined = run?.navigationEndpoint?.browseEndpoint?.browseId
  if (!browseId) return undefined

  const pageType = pageTypeOf(run)
  if (kind === 'artist') {
    return pageType === 'MUSIC_PAGE_TYPE_ARTIST' ||
      pageType === 'MUSIC_PAGE_TYPE_LIBRARY_ARTIST' ||
      browseId.startsWith('UC')
      ? browseId
      : undefined
  }

  return pageType === 'MUSIC_PAGE_TYPE_ALBUM' || browseId.startsWith('MPREb_')
    ? browseId
    : undefined
}

function partsFrom(runs: AnyObj[]): SubtitlePart[] {
  return runs
    .map((run): SubtitlePart | null => {
      const text = String(run.text ?? '')
      if (!text) return null
      const artistId = refId(run, 'artist')
      const albumId = refId(run, 'album')
      return {
        text,
        artistId,
        albumId,
        entity: artistId ? 'artist' : albumId ? 'album' : undefined
      }
    })
    .filter((part): part is SubtitlePart => part !== null)
}

/**
 * YouTube labels every playable item with a video type in its play endpoint:
 * `ATV` is an official audio track (what a music service should play), `OMV` a
 * music video, `UGC` a user upload. Anything else is unknown.
 */
function videoTypeOf(renderer: AnyObj): CatalogItem['videoType'] {
  const raw =
    renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs
      ?.watchEndpointMusicConfig?.musicVideoType ??
    renderer.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
      ?.playNavigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs
      ?.watchEndpointMusicConfig?.musicVideoType ??
    runsOf(renderer.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text)
      .find((run) => run.navigationEndpoint?.watchEndpoint)
      ?.navigationEndpoint.watchEndpoint.watchEndpointMusicSupportedConfigs
      ?.watchEndpointMusicConfig?.musicVideoType

  if (raw === 'MUSIC_VIDEO_TYPE_ATV') return 'audio'
  if (raw === 'MUSIC_VIDEO_TYPE_OMV') return 'video'
  if (raw === 'MUSIC_VIDEO_TYPE_UGC') return 'ugc'
  return undefined
}

function textOf(node: AnyObj | undefined | null): string {
  if (!node) return ''
  if (typeof node.simpleText === 'string') return node.simpleText
  if (Array.isArray(node.runs)) return node.runs.map((r: AnyObj) => r.text ?? '').join('')
  return ''
}

function runsOf(node: AnyObj | undefined | null): AnyObj[] {
  return Array.isArray(node?.runs) ? node.runs : []
}

function bestThumbnail(renderer: AnyObj): string | undefined {
  // List rows put art under `thumbnail`; carousel cards (albums, playlists,
  // artists) put it under `thumbnailRenderer`. Missing the second path is why
  // every card on Home rendered blank.
  const node = renderer?.thumbnailRenderer ?? renderer?.thumbnail
  const thumbs = node?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? node?.thumbnails
  if (!Array.isArray(thumbs) || thumbs.length === 0) return undefined

  const url: string | undefined = thumbs[thumbs.length - 1]?.url
  if (!url) return undefined

  // One size for every surface: sharp enough for a 168px hero on a 2x display,
  // small enough that a 40px list row is not a 100KB download.
  return url.replace(/=w\d+-h\d+/, '=w360-h360')
}

export function parseDuration(text: string): number | undefined {
  const trimmed = text.trim()
  if (!TIME_RE.test(trimmed)) return undefined
  return trimmed
    .split(':')
    .map(Number)
    .reduce((acc, part) => acc * 60 + part, 0)
}

function pageTypeOf(node: AnyObj | undefined): string | undefined {
  return (
    node?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig
      ?.pageType ??
    node?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
      ?.browseEndpointContextMusicConfig?.pageType
  )
}

/**
 * Some surfaces omit the page type entirely. The subtitle still says what the
 * thing is ("Album • 2013", "Profile • @handle"), which is enough for the UI to
 * label it and decide whether a click should open a page.
 */
function kindFromSubtitle(subtitle: string): CatalogKind {
  const prefix = subtitle.split('•')[0].trim().toLowerCase()

  switch (prefix) {
    case 'album':
    case 'single':
    case 'ep':
    case 'compilation':
      return 'album'
    case 'playlist':
    case 'podcast':
    case 'show':
      return 'playlist'
    case 'artist':
    case 'profile':
      return 'artist'
    default:
      return 'unknown'
  }
}

function kindFromPageType(pageType: string | undefined): CatalogKind {
  switch (pageType) {
    case 'MUSIC_PAGE_TYPE_ALBUM':
      return 'album'
    case 'MUSIC_PAGE_TYPE_ARTIST':
    case 'MUSIC_PAGE_TYPE_LIBRARY_ARTIST':
      return 'artist'
    case 'MUSIC_PAGE_TYPE_PLAYLIST':
    case 'MUSIC_PAGE_TYPE_LIBRARY_PLAYLIST':
      return 'playlist'
    case 'MUSIC_PAGE_TYPE_TRACK':
      return 'song'
    default:
      return 'unknown'
  }
}
