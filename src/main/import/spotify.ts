import type { ImportSource, ImportTrack } from '@shared/types'
import { readBoundedJson, readBoundedText } from '../bounded-body'

/**
 * Spotify playlists without the Web API.
 *
 * Spotify's official API is Premium-gated for app owners since February 2026.
 * The web player, however, hands an anonymous access token to the public embed
 * page, and its own `fetchPlaylist` GraphQL call returns public playlists a
 * page at a time. This is the same keyless path used by SpotifyScraper (MIT,
 * Ali Akhtari) — see https://github.com/AliAkhtari78/SpotifyScraper.
 *
 * Limits: public playlists only (private/collaborative links are invisible to
 * anonymous readers, and Liked Songs has no public URL). No ISRCs. If Spotify
 * rotates the persisted-query hash or the token shape, we fall back to the
 * embed's first 100 tracks rather than failing.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'
const PATHFINDER = 'https://api-partner.spotify.com/pathfinder/v1/query'
const PLAYLIST_OPERATION = 'fetchPlaylist'
/** Ported from SpotifyScraper. One-line update if Spotify rotates it. */
const PLAYLIST_HASH = 'a65e12194ed5fc443a1cdebed5fabe33ca5b07b987185d63c72483867ad13cb4'
const PAGE_SIZE = 100
const MAX_TRACKS = 10_000
const REQUEST_TIMEOUT_MS = 15_000

export class SpotifyImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpotifyImportError'
  }
}

type EmbedSession = { accessToken: string; expiresAt: number }

type EmbedEntity = {
  title?: string
  name?: string
  subtitle?: string
  coverArt?: { sources?: Array<{ url?: string; width?: number }> }
  trackList?: Array<{
    title?: string
    subtitle?: string
    uri?: string
    duration?: number
    isExplicit?: boolean
    isPlayable?: boolean
  }>
}

type EmbedBootstrap = {
  entity: EmbedEntity
  session: EmbedSession | null
}

type PathfinderTrack = {
  __typename?: string
  name?: string
  uri?: string
  mediaType?: string
  trackNumber?: number
  discNumber?: number
  contentRating?: { label?: string }
  playability?: { playable?: boolean }
  trackDuration?: { totalMilliseconds?: number }
  albumOfTrack?: { name?: string }
  artists?: { items?: Array<{ profile?: { name?: string } }> }
}

type PathfinderPage = {
  playlist?: { name?: string; totalCount?: number }
  items?: PathfinderTrack[]
  /** Raw item slots returned, including local files/episodes that are dropped. */
  rawCount?: number
  total?: number
}

function timeoutSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function get(url: string, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    signal: timeoutSignal(signal)
  })
}

function parsePlaylistId(input: string): string {
  const value = input.trim()
  if (/^[A-Za-z0-9]{22}$/.test(value)) return value

  const uri = value.match(/^spotify:playlist:([A-Za-z0-9]{22})$/)
  if (uri) return uri[1]

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new SpotifyImportError('Paste a valid Spotify playlist link')
  }

  if (!/^(open|play)\.spotify\.com$/i.test(url.hostname)) {
    throw new SpotifyImportError('That is not a Spotify link')
  }

  const match = url.pathname.match(/\/playlist\/([A-Za-z0-9]{22})/)
  if (!match) throw new SpotifyImportError('Only Spotify playlist links are supported')
  return match[1]
}

function parseNextData(html: string): unknown {
  const match = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!match) throw new SpotifyImportError('Spotify changed the playlist page; try again later')
  try {
    return JSON.parse(match[1])
  } catch {
    throw new SpotifyImportError('Could not read the Spotify playlist page')
  }
}

async function bootstrap(id: string, signal?: AbortSignal): Promise<EmbedBootstrap> {
  const res = await get(`https://open.spotify.com/embed/playlist/${id}`, signal)
  if (!res.ok) {
    throw new SpotifyImportError('This Spotify playlist is private, unavailable, or does not exist')
  }

  const next = parseNextData(await readBoundedText(res, 10 * 1024 * 1024)) as {
    props?: {
      pageProps?: {
        state?: {
          data?: { entity?: EmbedEntity }
          settings?: {
            session?: { accessToken?: unknown; accessTokenExpirationTimestampMs?: unknown }
          }
        }
      }
    }
  }

  const state = next.props?.pageProps?.state
  const entity = state?.data?.entity
  if (!entity) {
    throw new SpotifyImportError('This Spotify playlist is private, unavailable, or does not exist')
  }

  const token = state?.settings?.session?.accessToken
  const expires = state?.settings?.session?.accessTokenExpirationTimestampMs
  const session =
    typeof token === 'string' && token && typeof expires === 'number'
      ? { accessToken: token, expiresAt: expires }
      : null

  return { entity, session }
}

function bestCover(entity: EmbedEntity): string | undefined {
  const sources = entity.coverArt?.sources ?? []
  return sources
    .filter((source) => typeof source.url === 'string')
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url
}

function embedTrack(track: NonNullable<EmbedEntity['trackList']>[number]): ImportTrack | null {
  const title = track.title?.trim()
  if (!title) return null
  const id = track.uri?.split(':').pop()
  return {
    title,
    artists: (track.subtitle ?? '')
      .split(/,\s*/)
      .map((name) => name.trim())
      .filter(Boolean),
    durationSec: typeof track.duration === 'number' ? Math.round(track.duration / 1000) : undefined,
    explicit: track.isExplicit === true,
    available: track.isPlayable !== false,
    sourceId: id,
    sourceUrl: id ? `https://open.spotify.com/track/${id}` : undefined
  }
}

function normaliseTrack(track: PathfinderTrack): ImportTrack | null {
  if (!track?.name || track.__typename !== 'Track') return null
  if (track.mediaType && track.mediaType !== 'AUDIO') return null

  const id = track.uri?.split(':').pop()
  const artists = (track.artists?.items ?? [])
    .map((item) => item.profile?.name?.trim())
    .filter((name): name is string => Boolean(name))

  return {
    title: track.name,
    artists,
    album: track.albumOfTrack?.name,
    durationSec:
      typeof track.trackDuration?.totalMilliseconds === 'number'
        ? Math.max(1, Math.round(track.trackDuration.totalMilliseconds / 1000))
        : undefined,
    explicit: track.contentRating?.label === 'EXPLICIT',
    available: track.playability?.playable !== false,
    sourceId: id,
    sourceUrl: id ? `https://open.spotify.com/track/${id}` : undefined
  }
}

async function fetchPage(
  token: string,
  id: string,
  offset: number,
  signal?: AbortSignal
): Promise<PathfinderPage> {
  const variables = {
    uri: `spotify:playlist:${id}`,
    offset,
    limit: PAGE_SIZE,
    enableWatchFeedEntrypoint: false
  }
  const extensions = {
    persistedQuery: { version: 1, sha256Hash: PLAYLIST_HASH }
  }
  const url =
    `${PATHFINDER}?operationName=${PLAYLIST_OPERATION}` +
    `&variables=${encodeURIComponent(JSON.stringify(variables))}` +
    `&extensions=${encodeURIComponent(JSON.stringify(extensions))}`

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'app-platform': 'WebPlayer',
      'User-Agent': UA,
      'Accept-Language': 'en'
    },
    signal: timeoutSignal(signal)
  })

  if (res.status === 401 || res.status === 403) {
    throw new SpotifyImportError('Spotify token expired; retrying')
  }
  if (res.status === 429) {
    throw new SpotifyImportError('Spotify is rate-limiting imports right now. Try again shortly.')
  }
  if (!res.ok) {
    throw new SpotifyImportError(`Spotify returned HTTP ${res.status}`)
  }

  const payload = (await readBoundedJson(res, 20 * 1024 * 1024)) as {
    data?: {
      playlistV2?: {
        name?: string
        content?: {
          totalCount?: number
          items?: Array<{
            itemV2?: { data?: PathfinderTrack }
            itemV3?: { data?: PathfinderTrack }
          }>
        }
      }
    }
    errors?: unknown
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SpotifyImportError('Spotify returned an unreadable playlist')
  }
  if (payload.errors) throw new SpotifyImportError('Spotify rejected the playlist query')

  const playlist = payload.data?.playlistV2
  const rawItems = Array.isArray(playlist?.content?.items) ? playlist.content.items : []
  return {
    playlist: {
      name: playlist?.name,
      totalCount: playlist?.content?.totalCount
    },
    rawCount: rawItems.length,
    total: playlist?.content?.totalCount,
    items: rawItems
      .map((item) => item.itemV2?.data ?? item.itemV3?.data)
      .filter((track): track is PathfinderTrack => Boolean(track))
  }
}

/**
 * Resolve a public Spotify playlist link into the shared import shape.
 * Falls back to the embed's first 100 tracks if Spotify changes the GraphQL
 * endpoint. Throws only when the playlist itself cannot be read.
 */
export async function resolveSpotifyPlaylist(
  input: string,
  opts: { signal?: AbortSignal } = {}
): Promise<ImportSource> {
  const id = parsePlaylistId(input)
  const embed = await bootstrap(id, opts.signal)
  const url = `https://open.spotify.com/playlist/${id}`

  let tracks: ImportTrack[] = []
  let total = embed.entity.trackList?.length ?? 0
  let name = embed.entity.title ?? embed.entity.name ?? 'Spotify playlist'
  let pathfinderFailed = false

  if (embed.session) {
    try {
      let token = embed.session.accessToken
      let offset = 0
      let retriedToken = false
      while (offset < MAX_TRACKS) {
        let page: PathfinderPage
        try {
          page = await fetchPage(token, id, offset, opts.signal)
        } catch (error) {
          if (error instanceof Error && /token expired/i.test(error.message) && !retriedToken) {
            // The embed token is short-lived; fetch a fresh one and retry once.
            const fresh = await bootstrap(id, opts.signal)
            if (!fresh.session) throw error
            token = fresh.session.accessToken
            retriedToken = true
            continue
          }
          throw error
        }

        if (page.playlist?.name) name = page.playlist.name
        if (typeof page.total === 'number') total = page.total

        const pageTracks = (page.items ?? [])
          .map(normaliseTrack)
          .filter((track): track is ImportTrack => Boolean(track))
        tracks.push(...pageTracks)

        // Advance by the number of slots the server returned, not the number
        // that survived normalisation: local files and episodes still occupy
        // an offset, and skipping them would overlap the next page.
        const returned = page.rawCount ?? page.items?.length ?? 0
        if (returned === 0) break
        offset += returned
        if (total > 0 && offset >= total) break
        if (tracks.length >= MAX_TRACKS) break
      }
    } catch {
      // The embed fallback below keeps the feature useful while the private
      // endpoint is broken. Do not surface a scary error if we have data.
      pathfinderFailed = true
      tracks = []
      total = embed.entity.trackList?.length ?? 0
    }
  } else {
    pathfinderFailed = true
  }

  if (tracks.length === 0) {
    const fallback = (embed.entity.trackList ?? [])
      .map(embedTrack)
      .filter((track): track is ImportTrack => Boolean(track))
    if (fallback.length === 0) {
      throw new SpotifyImportError('This Spotify playlist has no readable tracks')
    }
    tracks = fallback
    total = embed.entity.trackList?.length ?? fallback.length
    pathfinderFailed = true
  }

  const shown = tracks.length
  const truncated =
    pathfinderFailed && shown >= PAGE_SIZE
      ? { shown, total: total > shown ? total : undefined }
      : undefined

  return {
    service: 'spotify',
    kind: 'playlist',
    id,
    url,
    title: name,
    creator: embed.entity.subtitle,
    cover: bestCover(embed.entity),
    totalTracks: total > 0 ? total : shown,
    ...(truncated ? { truncated } : {}),
    tracks
  }
}
