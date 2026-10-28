import type { PresenceSnapshot } from '@shared/types'

export type DiscordActivity = {
  name: string
  type: number
  details?: string
  state?: string
  /** Which field Discord prints after the music note in the member list. */
  status_display_type?: number
  timestamps?: { start?: number; end?: number }
  assets?: {
    large_image?: string
    large_text?: string
    large_url?: string
  }
  buttons?: { label: string; url: string }[]
}

const ACTIVITY_NAME = 'Viby'
/** Discord's "Listening" activity type; Playing (0) is the fallback if clients ignore it. */
const ACTIVITY_TYPE_LISTENING = 2
/** Show `state` (the artist) in the member list instead of the activity name. */
const STATUS_DISPLAY_STATE = 1
const TEXT_MAX = 128
const IMAGE_URL_MAX = 313
const LINK_MAX = 256
const GET_VIBY_URL = 'https://github.com/Rei-SU/Viby/releases/latest'

function text(value: string | undefined, max: number, min = 1): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed || trimmed.length < min) return undefined
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

/**
 * Discord accepts a direct HTTPS URL as the large image. YouTube Music's
 * thumbnails are already square; the short i.ytimg URL is a fallback for URLs
 * that would exceed Discord's 313-character limit.
 */
function artworkUrl(track: NonNullable<PresenceSnapshot['track']>): string | undefined {
  const thumbnail = track.thumbnail?.trim()
  if (thumbnail && /^https:\/\//i.test(thumbnail) && thumbnail.length <= IMAGE_URL_MAX) {
    return thumbnail
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(track.id)) {
    return `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`
  }
  return undefined
}

/**
 * The activity is null whenever playback is paused or stopped: the user chose
 * to clear the presence rather than show a paused card.
 */
export function buildActivity(
  snapshot: PresenceSnapshot,
  now = Date.now()
): DiscordActivity | null {
  const track = snapshot.track
  if (!track || !snapshot.playing) return null

  const duration = Math.max(0, track.durationSec)
  const projected = Math.max(0, snapshot.position) + Math.max(0, now - snapshot.updatedAt) / 1000
  const position = duration > 0 ? Math.min(projected, duration) : projected
  const start = Math.round(now - position * 1000)
  const timestamps: DiscordActivity['timestamps'] = { start }
  if (duration > 0) timestamps.end = Math.round(start + duration * 1000)

  const art = artworkUrl(track)
  const largeText = text(track.album || track.title, TEXT_MAX, 1)
  const largeUrl = text(
    track.id ? `https://music.youtube.com/watch?v=${encodeURIComponent(track.id)}` : undefined,
    LINK_MAX,
    1
  )

  return {
    name: ACTIVITY_NAME,
    type: ACTIVITY_TYPE_LISTENING,
    details: text(track.title, TEXT_MAX, 2),
    // The member list shows this line; the card keeps the album on the art.
    state: text(track.artist, TEXT_MAX, 2),
    status_display_type: STATUS_DISPLAY_STATE,
    timestamps,
    assets: art
      ? {
          large_image: art,
          large_text: largeText,
          large_url: largeUrl
        }
      : undefined,
    buttons: [{ label: 'Get Viby', url: GET_VIBY_URL }]
  }
}
