import type { PresenceSnapshot } from '@shared/types'

export type DiscordActivity = {
  name: string
  type: number
  details?: string
  details_url?: string
  state?: string
  state_url?: string
  /** Which field Discord prints after the music note in the member list. */
  status_display_type?: number
  timestamps?: { start?: number; end?: number }
  assets?: {
    large_image?: string
    large_text?: string
    large_url?: string
    small_image?: string
    small_text?: string
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

/**
 * Animated badges must be external URLs: Discord does not animate uploaded
 * assets. This spinning record lives in the repository and is served from main
 * after merge.
 */
export const DISCORD_BADGE_URL =
  'https://raw.githubusercontent.com/Rei-SU/Viby/main/assets/discord-vinyl.gif'

function text(value: string | undefined, max: number, min = 1): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length < min) return undefined
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

/** URLs are never truncated: a cut URL is worse than no link at all. */
function link(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > LINK_MAX || !/^https?:\/\//i.test(trimmed)) return undefined
  return trimmed
}

function imageLink(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > IMAGE_URL_MAX || !/^https:\/\//i.test(trimmed)) return undefined
  return trimmed
}

/**
 * Discord accepts a direct HTTPS URL as the large image. YouTube Music's
 * thumbnails are already square; the short i.ytimg URL is a fallback for URLs
 * that would exceed Discord's 313-character limit.
 */
function artworkUrl(track: NonNullable<PresenceSnapshot['track']>): string | undefined {
  const thumbnail = imageLink(track.thumbnail)
  if (thumbnail) return thumbnail
  if (typeof track.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(track.id)) {
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
  now = Date.now(),
  badgeUrl = DISCORD_BADGE_URL
): DiscordActivity | null {
  const track = snapshot.track
  if (!track || typeof track !== 'object' || !snapshot.playing) return null

  const duration = Number.isFinite(track.durationSec) ? Math.max(0, track.durationSec) : 0
  const rawPosition = Number.isFinite(snapshot.position) ? Math.max(0, snapshot.position) : 0
  const updatedAt = Number.isFinite(snapshot.updatedAt) ? snapshot.updatedAt : now
  const projected = rawPosition + Math.max(0, now - updatedAt) / 1000
  const position = duration > 0 ? Math.min(projected, duration) : projected
  const start = Math.round(now - position * 1000)
  const timestamps: DiscordActivity['timestamps'] = { start }
  if (duration > 0) timestamps.end = Math.round(start + duration * 1000)

  const trackId = typeof track.id === 'string' ? track.id : ''
  const title = text(track.title, TEXT_MAX, 2)
  const artist = text(track.artist, TEXT_MAX, 2)
  if (!trackId && !title && !artist) return null

  const trackUrl = link(
    trackId ? `https://music.youtube.com/watch?v=${encodeURIComponent(trackId)}` : undefined
  )
  const artistId = typeof track.artistId === 'string' ? track.artistId.trim() : ''
  const artistName = typeof track.artist === 'string' ? track.artist : ''
  const artistUrl = link(
    artistId && /^UC[A-Za-z0-9_-]+$/.test(artistId)
      ? `https://music.youtube.com/channel/${encodeURIComponent(artistId)}`
      : artistName
        ? `https://music.youtube.com/search?q=${encodeURIComponent(artistName)}`
        : undefined
  )
  const art = artworkUrl(track)
  const badge = imageLink(badgeUrl)
  const largeText = text(track.album || track.title, TEXT_MAX, 1)
  const quality = typeof snapshot.quality === 'string' ? snapshot.quality.trim() : ''
  const smallText = text(
    quality ? `Playing · ${quality}` : 'Playing',
    TEXT_MAX,
    1
  )

  const assets: DiscordActivity['assets'] =
    art || badge
      ? {
          ...(art ? { large_image: art, large_text: largeText, large_url: trackUrl } : {}),
          ...(badge ? { small_image: badge, small_text: smallText } : {})
        }
      : undefined

  const buttons: { label: string; url: string }[] = [{ label: 'Get Viby', url: GET_VIBY_URL }]
  if (trackUrl) buttons.push({ label: 'Listen on YouTube Music', url: trackUrl })

  return {
    name: ACTIVITY_NAME,
    type: ACTIVITY_TYPE_LISTENING,
    details: title,
    details_url: trackUrl,
    // The member list shows this line; the card keeps the album on the art.
    state: artist,
    state_url: artistUrl,
    status_display_type: STATUS_DISPLAY_STATE,
    timestamps,
    assets,
    buttons
  }
}
