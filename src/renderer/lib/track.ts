import type { CatalogItem, SubtitlePart, Track } from '@shared/types'
import { artistNames, artistPartsFor } from '@shared/artist-credits'

/**
 * A plain copy safe to send over IPC.
 *
 * Track fields are primitives except `artistParts`. The player's state is a
 * Svelte 5 proxy, and structured clone rejects proxies even when they wrap
 * plain data ("An object could not be cloned."). A shallow `{ ...track }` was
 * enough until that nested array existed (PLAN bug B14, one level deeper).
 */
export function plainTrack(track: Track): Track {
  return track.artistParts?.length
    ? { ...track, artistParts: plainParts(track.artistParts) }
    : { ...track }
}

export function plainParts(parts: SubtitlePart[] | undefined): SubtitlePart[] | undefined {
  return parts?.map((part) => ({ ...part }))
}

/** Playlist entries are tracks; rows and the player speak catalog items. */
export function trackToItem(track: Track): CatalogItem {
  const credit = artistPartsFor(track)
  const parts: SubtitlePart[] = credit.length
    ? [...credit]
    : track.artist
      ? [{ text: track.artist }]
      : []
  if (track.album) {
    if (parts.length > 0) parts.push({ text: ' · ' })
    parts.push({ text: track.album, albumId: track.albumId, entity: 'album' })
  }

  const artists = artistNames(credit)

  return {
    id: track.id,
    kind: 'song',
    title: track.title,
    subtitle: track.album ? `${track.artist} · ${track.album}` : track.artist,
    album: track.album,
    albumId: track.albumId,
    releaseType: track.releaseType,
    artists: artists.length ? artists : track.artist ? [track.artist] : undefined,
    thumbnail: track.thumbnail,
    durationSec: track.durationSec,
    views: track.views,
    videoType: track.videoType,
    parts: parts.length ? parts : undefined
  }
}
