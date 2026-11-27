import type { Repeat, Result, Track } from './types'

/**
 * Spotify-Connect-style device hand-off inside one account.
 *
 * Devices see each other on a private Realtime channel scoped to the account
 * (`account:<userId>:devices`). Presence carries each device's slow-changing
 * state; broadcast carries commands and instant state updates, because Presence
 * allows only five calls per client per 30 seconds.
 */
export const CONNECT_CH = {
  connectState: 'connect:state',
  connectPublish: 'connect:publish',
  connectSend: 'connect:send',
  connectChanged: 'connect:changed',
  connectCommand: 'connect:command',
  connectClaim: 'connect:claim'
} as const

/** The little of a track another device needs to draw a row. */
export type ConnectTrack = {
  id: string
  title: string
  artist: string
  artistId?: string
  album?: string
  durationSec: number
  thumbnail?: string
}

/** What this device publishes: the player, without its queue. */
export type ConnectSnapshot = {
  track: ConnectTrack | null
  playing: boolean
  position: number
  volume: number
  muted: boolean
  /**
   * When this device last *claimed* playback. A later claim pauses any other
   * device that is playing, so exactly one device is audible at a time.
   */
  claimAt: number
  updatedAt: number
}

export type ConnectDevice = ConnectSnapshot & {
  /** Stable install id, also the Presence key. */
  id: string
  name: string
  /** `macOS`, `Windows` or `Linux`. */
  platform: string
}

export type ConnectState = {
  /** The channel is joined; false while connecting, signed out or offline. */
  available: boolean
  selfId: string
  /** This install's display name, so the list can name it before joining. */
  name: string
  devices: ConnectDevice[]
}

/**
 * A device's playable session, handed over on transfer. Queue and index use the
 * persisted-session convention: `index` counts from the start of `queue`.
 */
export type ConnectSession = {
  track: Track | null
  queue: Track[]
  index: number
  position: number
  playing: boolean
  shuffle: boolean
  repeat: Repeat
}

/** What a controller sends; main adds id, sender and timestamp. */
export type ConnectCommandInput =
  | { kind: 'play' | 'pause' | 'next' | 'previous'; target: string }
  | { kind: 'volume'; target: string; volume: number }
  /** Ask `target` to hand its session to device `to`. */
  | { kind: 'transfer-out'; target: string; to: string }
  /** The hand-off itself, addressed to `target`. */
  | { kind: 'transfer-in'; target: string; session: ConnectSession }

export type ConnectCommand = ConnectCommandInput & {
  id: string
  from: string
  issuedAt: number
}

/** A device announcing that playback started there. */
export type ConnectClaim = { deviceId: string; at: number }

export interface ConnectApi {
  state(): Promise<ConnectState>
  /** Fire-and-forget player mirror; main throttles what reaches the channel. */
  publish(snapshot: ConnectSnapshot): void
  send(command: ConnectCommandInput): Promise<Result<void>>
  onChange(callback: (state: ConnectState) => void): () => void
  onCommand(callback: (command: ConnectCommand) => void): () => void
  onClaim(callback: (claim: ConnectClaim) => void): () => void
}
