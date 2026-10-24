import type { ImportSource, ImportTrack } from '@shared/types'
import { ImportError } from './errors'
import { playlistItems } from '../innertube/client'

/**
 * YouTube Music playlist import. The catalog client already parses rows into
 * CatalogItems; this just follows the 100-row continuations and normalises.
 * The source ids are already YouTube ids, so matching is exact and instant.
 */
export async function resolveYoutube(listId: string, signal?: AbortSignal): Promise<ImportSource> {
  if (!listId) throw new ImportError('That YouTube Music link has no playlist id')
  if (listId.startsWith('RD')) {
    throw new ImportError('That is an endless radio mix. Paste a normal playlist instead.')
  }
  if (listId.startsWith('LL') || listId.startsWith('WL')) {
    throw new ImportError('That playlist is private. Make it public, then paste the link again.')
  }

  const { items, header } = await playlistItems(`VL${listId}`, signal)
  const tracks: ImportTrack[] = []

  for (const item of items) {
    if (item.kind !== 'song' || !item.id) continue
    const parts = item.parts ?? []
    const linkedArtists = parts.filter((part) => part.artistId).map((part) => part.text)
    const artists = item.artists?.length ? item.artists : linkedArtists
    tracks.push({
      title: item.title,
      artists: artists.length ? artists : parts[0]?.text ? [parts[0].text] : [],
      album: parts.find((part) => part.albumId)?.text,
      durationSec: item.durationSec,
      thumbnail: item.thumbnail,
      videoType: item.videoType,
      artistId: parts.find((part) => part.artistId)?.artistId,
      albumId: parts.find((part) => part.albumId)?.albumId,
      sourceId: item.id,
      sourceUrl: `https://music.youtube.com/watch?v=${item.id}`
    })
  }

  if (tracks.length === 0) {
    throw new ImportError('This YouTube Music playlist has no playable songs')
  }

  return {
    service: 'youtube',
    kind: 'playlist',
    id: listId,
    url: `https://music.youtube.com/playlist?list=${encodeURIComponent(listId)}`,
    title: header?.title ?? 'YouTube Music playlist',
    creator: header?.subtitle,
    cover: header?.thumbnail,
    totalTracks: tracks.length,
    tracks
  }
}
