import type { ImportSource, ImportTrack } from '@shared/types'
import { ImportError } from './errors'
import { getJson, sleep } from './http'

type DeezerTrack = {
  id: number
  title: string
  duration: number
  explicit_lyrics?: boolean
  readable?: boolean
  link?: string
  artist?: { name?: string }
  album?: { title?: string }
}

type DeezerPlaylist = {
  id: number
  title: string
  nb_tracks?: number
  picture_xl?: string
  picture_big?: string
  picture_medium?: string
  creator?: { name?: string }
  artist?: { name?: string }
  tracks?: { data?: DeezerTrack[] }
  error?: { message?: string; code?: number }
}

type DeezerPage = { data?: DeezerTrack[]; total?: number; error?: unknown }

function toTrack(track: DeezerTrack): ImportTrack {
  return {
    title: track.title,
    artists: track.artist?.name ? [track.artist.name] : [],
    album: track.album?.title,
    durationSec: typeof track.duration === 'number' ? track.duration : undefined,
    explicit: track.explicit_lyrics === true,
    available: track.readable !== false,
    sourceId: String(track.id),
    sourceUrl: track.link ?? `https://www.deezer.com/track/${track.id}`
  }
}

export async function resolveDeezer(id: string, signal?: AbortSignal): Promise<ImportSource> {
  const meta = await getJson<DeezerPlaylist>(`https://api.deezer.com/playlist/${id}`, {
    signal
  })

  if (meta.error) {
    throw new ImportError(meta.error.message ?? 'This Deezer playlist is unavailable')
  }

  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new ImportError('Deezer returned an unreadable playlist')
  }
  if (meta.title !== undefined && typeof meta.title !== 'string') {
    throw new ImportError('Deezer returned an unreadable playlist')
  }
  let tracks = Array.isArray(meta.tracks?.data) ? meta.tracks.data : []
  const total = typeof meta.nb_tracks === 'number' ? meta.nb_tracks : tracks.length

  // The playlist object usually inlines every track, but page explicitly when
  // Spotify's 10k-track cousin appears in the wild (Deezer's cap is lower, but
  // the API paginates the same way).
  while (tracks.length < total) {
    const page = await getJson<DeezerPage>(
      `https://api.deezer.com/playlist/${id}/tracks?limit=100&index=${tracks.length}`,
      { signal }
    )
    if (!page || typeof page !== 'object' || page.error || !Array.isArray(page.data) || page.data.length === 0) {
      break
    }
    tracks = [...tracks, ...page.data]
    await sleep(120)
    if (tracks.length >= 10_000) break
  }

  if (tracks.length === 0) {
    throw new ImportError('This Deezer playlist has no readable tracks')
  }

  return {
    service: 'deezer',
    kind: 'playlist',
    id,
    url: `https://www.deezer.com/playlist/${id}`,
    title: meta.title || 'Deezer playlist',
    creator: meta.creator?.name ?? meta.artist?.name,
    cover: meta.picture_xl ?? meta.picture_big ?? meta.picture_medium,
    totalTracks: total,
    ...(tracks.length < total ? { truncated: { shown: tracks.length, total } } : {}),
    tracks: tracks.filter((track) => track && typeof track.title === 'string').map(toTrack)
  }
}
