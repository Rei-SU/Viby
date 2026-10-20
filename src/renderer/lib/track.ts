import type { CatalogItem, Track } from '@shared/types'

/** Playlist entries are tracks; rows and the player speak catalog items. */
export function trackToItem(track: Track): CatalogItem {
  return {
    id: track.id,
    kind: 'song',
    title: track.title,
    subtitle: track.artist,
    artists: track.artist ? [track.artist] : undefined,
    thumbnail: track.thumbnail,
    durationSec: track.durationSec,
    views: track.views,
    videoType: track.videoType,
    parts: track.artist ? [{ text: track.artist, artistId: track.artistId }] : undefined
  }
}
