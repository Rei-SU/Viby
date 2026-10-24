import type { ImportSource, ImportTrack } from '@shared/types'
import { ImportError } from './errors'
import { getJson, getText } from './http'

type SoundcloudTrack = {
  id?: number
  kind?: string
  title?: string
  duration?: number
  streamable?: boolean
  permalink_url?: string
  artwork_url?: string
  user?: { username?: string }
}

type SoundcloudSet = {
  kind?: string
  title?: string
  track_count?: number
  artwork_url?: string
  user?: { username?: string }
  tracks?: SoundcloudTrack[]
  permalink_url?: string
}

let clientIdCache: { id: string; at: number } | null = null
const CLIENT_ID_TTL = 6 * 60 * 60_000

async function discoverClientId(signal?: AbortSignal): Promise<string> {
  if (clientIdCache && Date.now() - clientIdCache.at < CLIENT_ID_TTL) {
    return clientIdCache.id
  }

  const home = await getText('https://soundcloud.com/', { signal })
  const assets = [...home.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)]
    .map((match) => match[1])
    .slice(0, 20)

  for (const asset of assets) {
    const js = await getText(asset, { signal })
    const found = js.match(/client_id\s*[:=]\s*["']([\w-]{20,})["']/)
    if (found) {
      clientIdCache = { id: found[1], at: Date.now() }
      return found[1]
    }
  }

  throw new ImportError('SoundCloud import is temporarily unavailable. Try again later.')
}

function toTrack(track: SoundcloudTrack): ImportTrack | null {
  if (track.kind !== 'track' || !track.title || typeof track.id !== 'number') return null
  return {
    title: track.title,
    artists: track.user?.username ? [track.user.username] : [],
    durationSec: typeof track.duration === 'number' ? Math.round(track.duration / 1000) : undefined,
    available: track.streamable !== false,
    sourceId: String(track.id),
    sourceUrl: track.permalink_url
  }
}

export async function resolveSoundcloud(url: string, signal?: AbortSignal): Promise<ImportSource> {
  let clientId = await discoverClientId(signal)
  let res = await getJson<SoundcloudSet>(
    `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`,
    { signal }
  ).catch((error) => {
    // A 401/403 means the cached web-player client id rotated.
    if (error instanceof Error && /HTTP (401|403)/.test(error.message)) {
      clientIdCache = null
      return null
    }
    throw error
  })

  if (!res) {
    clientId = await discoverClientId(signal)
    res = await getJson<SoundcloudSet>(
      `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`,
      { signal }
    )
  }

  if (res.kind !== 'playlist') {
    throw new ImportError('That SoundCloud link is not a playlist (set)')
  }

  if (!res || typeof res !== 'object' || Array.isArray(res)) {
    throw new ImportError('SoundCloud returned an unreadable playlist')
  }
  const tracks = (Array.isArray(res.tracks) ? res.tracks : [])
    .map(toTrack)
    .filter((track): track is ImportTrack => Boolean(track))

  if (tracks.length === 0) {
    throw new ImportError('This SoundCloud playlist has no readable tracks')
  }

  const total = res.track_count ?? tracks.length
  return {
    service: 'soundcloud',
    kind: 'playlist',
    url,
    title: res.title || 'SoundCloud playlist',
    creator: res.user?.username,
    cover: res.artwork_url ?? res.tracks?.[0]?.artwork_url,
    totalTracks: total,
    ...(tracks.length < total ? { truncated: { shown: tracks.length, total } } : {}),
    tracks
  }
}
