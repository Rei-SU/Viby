import type {
  ConnectClaim,
  ConnectCommand,
  ConnectCommandInput,
  ConnectDevice,
  ConnectState
} from '@shared/connect'
import { api } from './api'
import { player } from './player.svelte'
import { toast } from './toast.svelte'

/** How long another device has to answer a transfer before we give up. */
const TRANSFER_TIMEOUT_MS = 4_000
/**
 * A remote command changes player state asynchronously; keep the claim
 * suppression window open long enough that the resulting publish cannot be
 * mistaken for the user starting playback here.
 */
const APPLY_SUPPRESS_MS = 1_500

/**
 * The renderer's view of account devices. Main owns the channel; this store
 * mirrors the player outward, applies incoming commands, and decides the
 * single-active-device rule from claims.
 */
class ConnectStore {
  available = $state(false)
  selfId = $state('')
  name = $state('')
  devices = $state<ConnectDevice[]>([])
  open = $state(false)
  /** Device waiting on a hand-off we asked for. */
  busyId = $state('')

  private started = false
  private disposers: (() => void)[] = []
  private applying = 0
  private claimAt = 0
  private lastPlaying = false
  private pending: { timer: ReturnType<typeof setTimeout> } | null = null

  get self(): ConnectDevice | null {
    return this.devices.find((device) => device.id === this.selfId) ?? null
  }

  /** Other devices, playing first, then by name. */
  get others(): ConnectDevice[] {
    return this.devices
      .filter((device) => device.id !== this.selfId)
      .sort(
        (a, b) => Number(b.playing) - Number(a.playing) || a.name.localeCompare(b.name)
      )
  }

  get remotePlaying(): ConnectDevice | null {
    return this.others.find((device) => device.playing) ?? null
  }

  init(): void {
    if (this.started) return
    this.started = true
    const bridge = api.connect
    if (!bridge) return
    try {
      this.disposers.push(bridge.onChange((state) => this.apply(state)))
      this.disposers.push(bridge.onCommand((command) => void this.handleCommand(command)))
      this.disposers.push(bridge.onClaim((claim) => this.handleClaim(claim)))
    } catch {
      return
    }
    void bridge
      .state()
      .then((state) => this.apply(state))
      .catch(() => {})
  }

  toggle(): void {
    this.open = !this.open
  }

  close(): void {
    this.open = false
  }

  /**
   * Mirror the local player into main. Called from the same effect that feeds
   * Discord, so both presences always describe the same playback state.
   */
  publish(): void {
    const bridge = api.connect
    if (!bridge) return
    const track = player.current
    const playing = player.playing && !!track
    const now = Date.now()
    if (playing && !this.lastPlaying && this.applying === 0) this.claimAt = now
    this.lastPlaying = playing
    bridge.publish({
      track: track
        ? {
            id: track.id,
            title: track.title,
            artist: track.artist,
            artistId: track.artistId,
            album: track.album,
            durationSec: track.durationSec,
            thumbnail: track.thumbnail
          }
        : null,
      playing,
      position: player.position,
      volume: player.volume,
      muted: player.muted,
      claimAt: this.claimAt,
      updatedAt: now
    })
  }

  async remotePlayPause(device: ConnectDevice): Promise<void> {
    await this.send({ kind: device.playing ? 'pause' : 'play', target: device.id })
  }

  async remoteNext(device: ConnectDevice): Promise<void> {
    await this.send({ kind: 'next', target: device.id })
  }

  async remotePrevious(device: ConnectDevice): Promise<void> {
    await this.send({ kind: 'previous', target: device.id })
  }

  async remoteVolume(device: ConnectDevice, volume: number): Promise<void> {
    await this.send({ kind: 'volume', target: device.id, volume })
  }

  /** Ask another device to hand its session to this one. */
  async playHere(device: ConnectDevice): Promise<void> {
    const bridge = api.connect
    if (!bridge || !this.available || this.busyId) return
    this.clearPending()
    this.busyId = device.id
    this.pending = {
      timer: setTimeout(() => {
        this.pending = null
        this.busyId = ''
        toast.show(`${device.name} did not answer.`)
      }, TRANSFER_TIMEOUT_MS)
    }
    const result = await bridge.send({
      kind: 'transfer-out',
      target: device.id,
      to: this.selfId
    })
    if (!result.ok) {
      this.clearPending()
      toast.show(result.error)
    }
  }

  private apply(state: ConnectState): void {
    const joined = state.available && !this.available
    this.available = state.available
    this.selfId = state.selfId
    this.name = state.name
    this.devices = [...state.devices]
    if (joined) this.publish()
    if (state.available && !this.pending) this.busyId = ''
  }

  private async send(input: ConnectCommandInput): Promise<void> {
    const bridge = api.connect
    if (!bridge) return
    const result = await bridge.send(input)
    if (!result.ok) toast.show(result.error)
  }

  private handleClaim(claim: ConnectClaim): void {
    if (!player.playing || claim.deviceId === this.selfId) return
    const newer =
      claim.at > this.claimAt || (claim.at === this.claimAt && claim.deviceId > this.selfId)
    if (!newer) return
    this.remote(() => {
      if (player.playing) player.toggle()
    })
    const name = this.devices.find((device) => device.id === claim.deviceId)?.name
    toast.show(name ? `Paused — playing on ${name}` : 'Paused — playing on another device')
  }

  private async handleCommand(command: ConnectCommand): Promise<void> {
    if (command.target !== this.selfId) return
    switch (command.kind) {
      // Play/next/previous are not suppressed: if they make this device start
      // playing, the ordinary publish claims playback and pauses the other
      // device, exactly like pressing play here.
      case 'play':
        if (!player.playing) player.toggle()
        return
      case 'pause':
        if (player.playing) player.toggle()
        return
      case 'next':
        player.next()
        return
      case 'previous':
        player.previous()
        return
      case 'volume':
        player.setVolume(command.volume)
        return
      case 'transfer-out': {
        const session = player.transferSession()
        if (!session) return
        // "Play here" is an intent to listen there, even if this device was
        // paused: hand over a playing session.
        const result = await api.connect.send({
          kind: 'transfer-in',
          target: command.from,
          session: { ...session, playing: true }
        })
        // The session now belongs to the other device; stop here quietly.
        if (result.ok) {
          this.remote(() => {
            if (player.playing) player.toggle()
          })
        }
        return
      }
      case 'transfer-in': {
        this.clearPending()
        this.applying += 1
        try {
          await player.adoptRemote(command.session)
        } finally {
          this.applying = Math.max(0, this.applying - 1)
        }
        // The adopted session is this device's now: announce it so any other
        // player pauses. A paused hand-off claims nothing.
        if (player.playing) this.claimAt = Date.now()
        this.publish()
        return
      }
    }
  }

  /** Run a player change that came from another device, not from a user here. */
  private remote(run: () => void): void {
    this.applying += 1
    try {
      run()
    } finally {
      setTimeout(() => {
        this.applying = Math.max(0, this.applying - 1)
      }, APPLY_SUPPRESS_MS)
    }
  }

  private clearPending(): void {
    if (this.pending) clearTimeout(this.pending.timer)
    this.pending = null
    this.busyId = ''
  }
}

export const connect = new ConnectStore()
