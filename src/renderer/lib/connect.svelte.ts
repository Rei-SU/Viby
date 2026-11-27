import type {
  ConnectClaim,
  ConnectCommand,
  ConnectCommandInput,
  ConnectDevice,
  ConnectSession,
  ConnectState
} from '@shared/connect'
import type { Track } from '@shared/types'
import { DeviceClock } from './device-clock'
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
  /** When this device last claimed playback; newer remote claims take over. */
  claimAt = $state(0)

  private started = false
  private disposers: (() => void)[] = []
  private applying = 0
  private lastPlaying = false
  private pending: {
    deviceId: string
    requestId: string
    timer: ReturnType<typeof setTimeout> | null
  } | null = null
  /** Each device's clock and playback position, modelled from fresh samples. */
  private clocks = new DeviceClock()

  constructor() {
    // Claims decide which device the bar mirrors; losing ours on restart would
    // hand the bar to a remote device that last played long ago.
    try {
      const stored = Number(localStorage.getItem('viby-connect-claim'))
      if (Number.isFinite(stored) && stored > 0) this.claimAt = stored
    } catch {
      // Storage unavailable: claims simply start at zero for this run.
    }
  }

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

  /** What every surface should show: the active device's track, else ours. */
  get activeTrack(): Track | null {
    const device = this.remote
    return device ? this.trackOf(device) : player.current
  }

  /** A device's snapshot as the Track shape the rest of the app speaks. */
  trackOf(device: ConnectDevice): Track | null {
    const track = device.track
    if (!track) return null
    return {
      id: track.id,
      title: track.title,
      artist: track.artist,
      artistId: track.artistId,
      album: track.album,
      durationSec: track.durationSec,
      thumbnail: track.thumbnail
    }
  }

  /** Where that device is right now, corrected for clock difference. */
  devicePosition(device: ConnectDevice): number {
    return this.clocks.position(device)
  }

  /**
   * The device whose session this window should mirror: the latest claim, when
   * it is newer than ours. Spotify behaves this way — a controller window shows
   * the remote session, not its own paused one.
   */
  get remote(): ConnectDevice | null {
    let best: ConnectDevice | null = null
    for (const device of this.devices) {
      if (device.id === this.selfId || !device.track) continue
      if (device.claimAt <= this.claimAt) continue
      if (
        !best ||
        device.claimAt > best.claimAt ||
        (device.claimAt === best.claimAt && device.id > best.id)
      ) {
        best = device
      }
    }
    return best
  }

  init(): void {
    if (this.started) return
    this.started = true
    // New selections go to the active device while this window is a controller.
    player.remotePlay = (session) => this.playRemote(session)
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
    if (playing && !this.lastPlaying && this.applying === 0) this.setClaim(now)
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
      // The exact element clock, not the 1 Hz mirror, so a pause or seek hands
      // the other device the position it actually stopped at.
      position: player.clock,
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

  /** Move the other device's playhead; the bar shows the jump immediately. */
  async remoteSeek(
    device: ConnectDevice,
    trackId: string,
    position: number
  ): Promise<void> {
    const bridge = api.connect
    if (!bridge) return
    const result = await bridge.send({
      kind: 'seek',
      target: device.id,
      trackId,
      position
    })
    if (!result.ok) {
      toast.show(result.error)
      return
    }
    // The jump belongs to that device's clock; stamping it with ours would
    // corrupt the offset estimate until the next sample.
    this.devices = this.devices.map((entry) =>
      entry.id === device.id
        ? { ...entry, position, updatedAt: this.clocks.stamp(device.id) }
        : entry
    )
  }

  /**
   * Route a new selection to the device that currently owns playback, like
   * Spotify: picking a song in a controller window plays it on that device.
   * Returns false when nothing is remote, so the player proceeds locally.
   */
  private playRemote(session: ConnectSession): boolean {
    const target = this.remote
    if (!target) return false
    void this.send({ kind: 'transfer-in', target: target.id, session })
    return true
  }

  /** Ask another device to hand its session to this one. */
  async playHere(device: ConnectDevice): Promise<void> {
    const bridge = api.connect
    if (!bridge || !this.available || this.busyId) return
    this.clearPending()
    this.busyId = device.id
    const pending = {
      deviceId: device.id,
      requestId: crypto.randomUUID(),
      timer: setTimeout(() => {
        this.pending = null
        this.busyId = ''
        toast.show(`${device.name} did not answer.`)
      }, TRANSFER_TIMEOUT_MS)
    }
    this.pending = pending
    const result = await bridge.send({
      kind: 'handoff-request',
      target: device.id,
      requestId: pending.requestId
    })
    if (!result.ok && this.pending === pending) {
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
    // Feed every row; the clock ignores repeats so presence heartbeats cannot
    // rewind a playing device to its last sample.
    this.clocks.observe(this.devices)
    if (joined) this.publish()
    if (!state.available && this.pending) this.clearPending()
    // A snapshot is also confirmation that the target is playing. This
    // covers a claim broadcast lost while either device was reconnecting.
    const active = this.remote
    if (active?.playing) this.handleClaim({ deviceId: active.id, at: active.claimAt })
    if (state.available && !this.pending) this.busyId = ''
  }

  private async send(input: ConnectCommandInput): Promise<void> {
    const bridge = api.connect
    if (!bridge) return
    const result = await bridge.send(input)
    if (!result.ok) toast.show(result.error)
  }

  private handleClaim(claim: ConnectClaim): void {
    if (!player.playing || this.applying > 0 || claim.deviceId === this.selfId) return
    const newer =
      claim.at > this.claimAt || (claim.at === this.claimAt && claim.deviceId > this.selfId)
    if (!newer) return
    this.applyRemote(() => {
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
      case 'seek':
        // Only the track the controller was looking at; a stale timestamp
        // must not jump whatever is playing now.
        if (player.current?.id === command.trackId) player.seek(command.position)
        return
      case 'transfer-out':
      case 'handoff-request': {
        const session = player.transferSession()
        if (!session) return
        // "Play here" is an intent to listen there, even if this device was
        // paused: hand over a playing session.
        await this.send({
          kind: 'transfer-in',
          target: command.from,
          session: { ...session, playing: true },
          ...(command.kind === 'handoff-request' ? { requestId: command.requestId } : {})
        })
        // Keep playing until the receiving device actually starts and claims.
        return
      }
      case 'transfer-in': {
        const pending = this.pending
        if (command.requestId) {
          if (pending?.requestId !== command.requestId || pending.deviceId !== command.from || !pending.timer) return
          clearTimeout(pending.timer)
          pending.timer = null
        }
        this.applying += 1
        let playing = false
        let current = false
        try {
          playing = await player.adoptRemote(command.session)
          current = this.available && (!command.requestId || this.pending === pending)
        } finally {
          this.applying = Math.max(0, this.applying - 1)
          if (command.requestId && this.pending === pending) this.clearPending()
        }
        // The adopted session is this device's now: announce it so any other
        // player pauses. A paused hand-off claims nothing.
        if (playing && current) {
          // A host clock can be behind the source's. A confirmed hand-off
          // must claim after the source's most recent claim on either clock.
          const source = this.devices.find((device) => device.id === command.from)
          this.setClaim(Math.max(Date.now(), this.claimAt + 1, (source?.claimAt ?? 0) + 1))
          this.lastPlaying = true
        } else if (current && command.requestId) {
          toast.show('Could not start playback here.')
        }
        this.publish()
        return
      }
    }
  }

  private setClaim(at: number): void {
    this.claimAt = at
    try {
      localStorage.setItem('viby-connect-claim', String(at))
    } catch {
      // A full or blocked storage area just means no cross-restart memory.
    }
  }

  /** Run a player change that came from another device, not from a user here. */
  private applyRemote(run: () => void): void {
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
    if (this.pending?.timer) clearTimeout(this.pending.timer)
    this.pending = null
    this.busyId = ''
  }
}

export const connect = new ConnectStore()
