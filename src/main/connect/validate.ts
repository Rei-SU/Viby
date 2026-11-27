import type {
  ConnectCommand,
  ConnectCommandInput,
  ConnectDevice,
  ConnectSession,
  ConnectSnapshot,
  ConnectTrack
} from '@shared/connect'
import type { Repeat, SubtitlePart, Track } from '@shared/types'

/**
 * Everything here crosses either IPC or the network, so nothing is trusted:
 * strings are bounded, numbers must be finite, and only known fields survive.
 */

const MAX_QUEUE = 100
const MAX_PARTS = 12
/** A command older than this is a delayed packet, not a fresh intent. */
export const COMMAND_MAX_AGE_MS = 2 * 60_000
/** Allowance for another machine's clock running ahead. */
export const COMMAND_MAX_AHEAD_MS = 60_000

const REPEATS: readonly Repeat[] = ['off', 'all', 'one']

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function asPart(value: unknown): SubtitlePart | null {
  if (!value || typeof value !== 'object') return null
  const part = value as Record<string, unknown>
  const body = text(part.text, 200)
  if (!body) return null
  const out: SubtitlePart = { text: body }
  const artistId = text(part.artistId, 64)
  const albumId = text(part.albumId, 64)
  const artistName = text(part.artistName, 200)
  if (artistId) out.artistId = artistId
  if (albumId) out.albumId = albumId
  if (artistName) out.artistName = artistName
  if (part.entity === 'artist' || part.entity === 'album') out.entity = part.entity
  return out
}

export function asTrack(value: unknown): Track | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const id = text(source.id, 64)
  const title = text(source.title, 300)
  const artist = text(source.artist, 300)
  const durationSec = finite(source.durationSec)
  if (!id || !title || !artist || durationSec === undefined) return null

  const track: Track = { id, title, artist, durationSec: Math.max(0, durationSec) }
  const artistId = text(source.artistId, 64)
  const album = text(source.album, 300)
  const albumId = text(source.albumId, 64)
  const releaseType = text(source.releaseType, 40)
  const thumbnail = text(source.thumbnail, 2000)
  const videoType = source.videoType
  const sourceId = text(source.sourceId, 64)
  if (artistId) track.artistId = artistId
  if (album) track.album = album
  if (albumId) track.albumId = albumId
  if (releaseType) track.releaseType = releaseType
  if (thumbnail) track.thumbnail = thumbnail
  if (sourceId) track.sourceId = sourceId
  if (videoType === 'audio' || videoType === 'video' || videoType === 'ugc') {
    track.videoType = videoType
  }
  if (Array.isArray(source.artistParts)) {
    const parts = source.artistParts
      .slice(0, MAX_PARTS)
      .map(asPart)
      .filter((part): part is SubtitlePart => part !== null)
    if (parts.length > 0) track.artistParts = parts
  }
  return track
}

export function asConnectTrack(value: unknown): ConnectTrack | null {
  const track = asTrack(value)
  if (!track) return null
  const out: ConnectTrack = {
    id: track.id,
    title: track.title,
    artist: track.artist,
    durationSec: track.durationSec
  }
  if (track.artistId) out.artistId = track.artistId
  if (track.album) out.album = track.album
  if (track.thumbnail) out.thumbnail = track.thumbnail
  return out
}

export function asSnapshot(value: unknown): ConnectSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const position = finite(source.position)
  const claimAt = finite(source.claimAt)
  const updatedAt = finite(source.updatedAt)
  const volume = finite(source.volume)
  if (position === undefined || claimAt === undefined || updatedAt === undefined) return null
  if (volume === undefined) return null
  let track: ConnectTrack | null = null
  if (source.track != null) {
    track = asConnectTrack(source.track)
    if (!track) return null
  }
  return {
    track,
    playing: source.playing === true,
    position: Math.max(0, position),
    volume: clamp01(volume),
    muted: source.muted === true,
    claimAt: Math.max(0, claimAt),
    updatedAt: Math.max(0, updatedAt)
  }
}

export function asDevice(value: unknown): ConnectDevice | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const id = text(source.id, 64)
  const name = text(source.name, 80)
  const platform = text(source.platform, 20)
  const snapshot = asSnapshot(source)
  if (!id || id.length < 8 || !name || !platform || !snapshot) return null
  return { id, name, platform, ...snapshot }
}

export function asSession(value: unknown): ConnectSession | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const track = source.track == null ? null : asTrack(source.track)
  if (source.track != null && !track) return null
  if (!Array.isArray(source.queue)) return null
  const queue = source.queue
    .slice(0, MAX_QUEUE)
    .map(asTrack)
    .filter((entry): entry is Track => entry !== null)
  const index = finite(source.index)
  const position = finite(source.position)
  if (index === undefined || position === undefined) return null
  if (queue.length === 0 && !track) return null
  const repeat = REPEATS.includes(source.repeat as Repeat) ? (source.repeat as Repeat) : 'off'
  return {
    track,
    queue,
    index: Math.max(0, Math.min(Math.trunc(index), Math.max(0, queue.length - 1))),
    position: Math.max(0, position),
    playing: source.playing !== false,
    shuffle: source.shuffle === true,
    repeat
  }
}

/** Outgoing command from this renderer, before main stamps id/from/issuedAt. */
export function asCommandInput(value: unknown): ConnectCommandInput | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const target = text(source.target, 64)
  if (!target) return null
  switch (source.kind) {
    case 'play':
    case 'pause':
    case 'next':
    case 'previous':
      return { kind: source.kind, target }
    case 'volume': {
      const volume = finite(source.volume)
      if (volume === undefined) return null
      return { kind: 'volume', target, volume: clamp01(volume) }
    }
    case 'seek': {
      const trackId = text(source.trackId, 64)
      const position = finite(source.position)
      if (!trackId || position === undefined) return null
      return { kind: 'seek', target, trackId, position: Math.max(0, Math.min(position, 86_400)) }
    }
    case 'transfer-out': {
      const to = text(source.to, 64)
      return to ? { kind: 'transfer-out', target, to } : null
    }
    case 'handoff-request': {
      const requestId = text(source.requestId, 64)
      return requestId ? { kind: 'handoff-request', target, requestId } : null
    }
    case 'transfer-in': {
      const session = asSession(source.session)
      const requestId = text(source.requestId, 64)
      if (!session || (source.requestId !== undefined && !requestId)) return null
      return requestId ? { kind: 'transfer-in', target, session, requestId } : { kind: 'transfer-in', target, session }
    }
    default:
      return null
  }
}

/** A command arriving over the wire, already addressed to this device. */
export function asCommand(
  value: unknown,
  selfId: string,
  now: number
): ConnectCommand | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const id = text(source.id, 64)
  const from = text(source.from, 64)
  const issuedAt = finite(source.issuedAt)
  if (!id || !from || issuedAt === undefined) return null
  if (source.target !== selfId) return null
  if (issuedAt < now - COMMAND_MAX_AGE_MS || issuedAt > now + COMMAND_MAX_AHEAD_MS) return null
  const input = asCommandInput(value)
  if (!input) return null
  if ((input.kind === 'transfer-in' || input.kind === 'handoff-request') && from === selfId) return null
  return { ...input, id, from, issuedAt }
}

export function asClaim(value: unknown, selfId: string): { deviceId: string; at: number } | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const deviceId = text(source.deviceId, 64)
  const at = finite(source.at)
  if (!deviceId || at === undefined || deviceId === selfId) return null
  return { deviceId, at: Math.max(0, at) }
}
