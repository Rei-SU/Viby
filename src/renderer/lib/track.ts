import type { CatalogItem, SubtitlePart, Track } from '@shared/types'

/** Playlist entries are tracks; rows and the player speak catalog items. */
export function trackToItem(track: Track): CatalogItem {
  const parts: SubtitlePart[] = []
  if (track.artist) {
    parts.push({ text: track.artist, artistId: track.artistId, entity: 'artist' })
  }
  if (track.album) {
    if (parts.length > 0) parts.push({ text: ' · ' })
    parts.push({ text: track.album, albumId: track.albumId, entity: 'album' })
  }

  return {
    id: track.id,
    kind: 'song',
    title: track.title,
    subtitle: track.album ? `${track.artist} · ${track.album}` : track.artist,
    artists: track.artist ? [track.artist] : undefined,
    thumbnail: track.thumbnail,
    durationSec: track.durationSec,
    views: track.views,
    videoType: track.videoType,
    parts: parts.length ? parts : undefined
  }
}
