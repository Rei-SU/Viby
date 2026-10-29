import type { Track } from '@shared/types'

/**
 * Catalog metadata is authoritative; a resolver record only fills gaps.
 *
 * `remember` used to replace the catalog snapshot with yt-dlp's record, which
 * knows an album name but no page id. History then backfilled that name and
 * turned it into a link that could only be guessed by searching the title.
 */
export function mergeTrackMetadata(previous: Track | undefined, incoming: Track): Track {
  if (!previous) return { ...incoming }

  const merged: Track = { ...previous }

  if (!merged.title) merged.title = incoming.title
  if (!merged.artist || /^unknown artist$/i.test(merged.artist)) {
    merged.artist = incoming.artist
    merged.artistId = incoming.artistId ?? merged.artistId
    merged.artistParts = incoming.artistParts ?? merged.artistParts
  }
  if (!merged.albumId && incoming.albumId) {
    merged.albumId = incoming.albumId
    merged.album = incoming.album ?? merged.album
  } else if (!merged.album && incoming.album) {
    merged.album = incoming.album
  }
  if (!merged.releaseType && incoming.releaseType) merged.releaseType = incoming.releaseType
  if (!(merged.durationSec > 0) && incoming.durationSec > 0) {
    merged.durationSec = incoming.durationSec
  }
  if (!merged.thumbnail && incoming.thumbnail) merged.thumbnail = incoming.thumbnail
  if (!merged.sourceUrl && incoming.sourceUrl) merged.sourceUrl = incoming.sourceUrl
  if (!merged.views && incoming.views) merged.views = incoming.views
  if (!merged.videoType && incoming.videoType) merged.videoType = incoming.videoType
  if (!merged.sourceId && incoming.sourceId) merged.sourceId = incoming.sourceId

  return merged
}
