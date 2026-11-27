import { randomUUID } from 'node:crypto'
import type {
  ConnectClaim,
  ConnectCommand,
  ConnectCommandInput,
  ConnectDevice,
  ConnectSnapshot,
  ConnectState
} from '@shared/connect'
import type { Result } from '@shared/types'
import { asClaim, asCommand, asCommandInput, asDevice, asSnapshot } from './validate'

/**
 * Isolated transport behind the device feature, so the service can be tested
 * with a fake and a missing WebSocket only disables the feature.
 */
export type ConnectChannel = {
  track(payload: ConnectDevice): Promise<void>
  /** One envelope: `{ type: 'state' | 'claim' | 'command', ... }`. */
  send(payload: unknown): Promise<void>
  leave(): Promise<void>
}

export type ConnectChannelHandlers = {
  /** Raw Presence payloads for the whole channel (including this device). */
  onDevices(payloads: unknown[]): void
  onMessage(payload: unknown): void
  onAvailable(available: boolean): void
}

export type ConnectChannelFactory = (
  topic: string,
  presenceKey: string,
  handlers: ConnectChannelHandlers
) => ConnectChannel | Promise<ConnectChannel>

export type ConnectServiceOptions = {
  deviceId: string
  name: string
  platform: string
  createChannel?: ConnectChannelFactory
  now?: () => number
  /** Presence calls are capped at 5 per 30 s; 7 s keeps a safe margin. */
  presenceGapMs?: number
  /** Broadcast state coalescing window. */
  stateGapMs?: number
}

type Listeners = {
  state: ((state: ConnectState) => void) | null
  command: ((command: ConnectCommand) => void) | null
  claim: ((claim: ConnectClaim) => void) | null
}

/**
 * The account's device channel: who else is online, what they are playing, and
 * commands between them. Nothing here runs signed out, and every failure only
 * makes devices unavailable — playback and sync never depend on it.
 */
export class ConnectService {
  private readonly now: () => number
  private readonly presenceGapMs: number
  private readonly stateGapMs: number
  private userId: string | null = null
  private channel: ConnectChannel | null = null
  private peers = new Map<string, ConnectDevice>()
  private self: ConnectDevice | null = null
  private available = false
  private lastPresenceAt = 0
  private lastClaimSent = 0
  private presenceTimer: ReturnType<typeof setTimeout> | null = null
  private stateTimer: ReturnType<typeof setTimeout> | null = null
  /** Keeps presence fresh through idle periods and channel reconnects. */
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private readonly listeners: Listeners = { state: null, command: null, claim: null }

  constructor(private readonly options: ConnectServiceOptions) {
    this.now = options.now ?? Date.now
    this.presenceGapMs = options.presenceGapMs ?? 7_000
    this.stateGapMs = options.stateGapMs ?? 800
  }

  onState(listener: (state: ConnectState) => void): void {
    this.listeners.state = listener
  }

  onCommand(listener: (command: ConnectCommand) => void): void {
    this.listeners.command = listener
  }

  onClaim(listener: (claim: ConnectClaim) => void): void {
    this.listeners.claim = listener
  }

  state(): ConnectState {
    const devices = this.self ? [this.self, ...this.peers.values()] : [...this.peers.values()]
    return {
      available: this.available,
      selfId: this.options.deviceId,
      name: this.options.name,
      devices: devices.map((device) => ({ ...device }))
    }
  }

  /** Follow sign-in state. Recovery sessions stay off until the password is set. */
  useAccount(userId: string | null): void {
    if (this.userId === userId) return
    this.teardown()
    if (!userId) return
    this.userId = userId
    if (!this.options.createChannel) {
      this.emit()
      return
    }
    try {
      const created = this.options.createChannel(
        `account:${userId}:devices`,
        this.options.deviceId,
        {
          onDevices: (payloads) => this.mergePresence(payloads),
          onMessage: (payload) => this.handleMessage(payload),
          onAvailable: (available) => this.setAvailable(available)
        }
      )
      if (typeof (created as Promise<ConnectChannel>).then === 'function') {
        void (created as Promise<ConnectChannel>)
          .then((channel) => {
            // The account may have changed while the token was being fetched.
            if (this.userId !== userId || this.channel !== null) {
              void channel.leave().catch(() => {})
              return
            }
            this.channel = channel
            // The join may have completed before the channel was attached;
            // publish now instead of waiting for the heartbeat.
            if (this.available) {
              this.lastPresenceAt = 0
              this.schedulePresence()
              this.scheduleState()
            }
          })
          .catch(() => {
            if (this.userId === userId) {
              this.available = false
              this.emit()
            }
          })
      } else {
        this.channel = created as ConnectChannel
      }
      this.emit()
    } catch {
      this.channel = null
      this.available = false
      this.emit()
    }
  }

  /** Mirror the local player. Cheap to call often; sends are throttled here. */
  publish(input: ConnectSnapshot): void {
    const snapshot = asSnapshot(input)
    if (!snapshot) return
    this.self = {
      id: this.options.deviceId,
      name: this.options.name,
      platform: this.options.platform,
      ...snapshot
    }
    if (this.channel && this.available && snapshot.claimAt > this.lastClaimSent) {
      this.lastClaimSent = snapshot.claimAt
      void this.channel
        .send({ type: 'claim', claim: { deviceId: this.options.deviceId, at: snapshot.claimAt } })
        .catch(() => {})
    }
    this.emit()
    this.scheduleState()
    this.schedulePresence()
  }

  async send(input: ConnectCommandInput): Promise<Result<void>> {
    const command = asCommandInput(input)
    if (!command) return { ok: false, error: 'That command was not understood.' }
    const channel = this.channel
    if (!this.userId || !channel || !this.available) {
      return { ok: false, error: 'Devices are not available right now.' }
    }
    const payload: ConnectCommand = {
      ...command,
      id: randomUUID(),
      from: this.options.deviceId,
      issuedAt: this.now()
    }
    try {
      await channel.send({ type: 'command', command: payload })
      return { ok: true, data: undefined }
    } catch {
      return { ok: false, error: 'Could not reach the other device.' }
    }
  }

  dispose(): void {
    this.teardown()
  }

  // ---- internals ---------------------------------------------------------

  private setAvailable(available: boolean): void {
    if (this.available === available) return
    this.available = available
    if (!available) this.peers.clear()
    this.emit()
    if (available) {
      // The join is fresh: publish the current snapshot without waiting for
      // the presence gap, then settle into the throttle.
      this.lastPresenceAt = 0
      this.schedulePresence()
      this.scheduleState()
      if (!this.heartbeat) {
        this.heartbeat = setInterval(() => this.presencePing(), 25_000)
        this.heartbeat.unref?.()
      }
    } else {
      if (this.heartbeat) clearInterval(this.heartbeat)
      this.heartbeat = null
    }
  }

  /**
   * A steady low-rate presence refresh. Peer views extrapolate the position, so
   * this only corrects drift, repairs a presence lost to a reconnect, and keeps
   * the device visible while it is idle.
   */
  private presencePing(): void {
    if (!this.channel || !this.available || !this.self) return
    this.lastPresenceAt = this.now()
    const self = this.self
    void this.channel.track(self).catch(() => {})
  }

  private mergePresence(payloads: unknown[]): void {
    const next = new Map<string, ConnectDevice>()
    for (const raw of payloads) {
      const device = asDevice(raw)
      if (!device || device.id === this.options.deviceId) continue
      next.set(device.id, device)
    }
    this.peers = next
    this.emit()
  }

  private handleMessage(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return
    const envelope = payload as Record<string, unknown>
    switch (envelope.type) {
      case 'state': {
        const device = asDevice(envelope.device)
        if (!device || device.id === this.options.deviceId) return
        this.peers.set(device.id, device)
        this.emit()
        return
      }
      case 'claim': {
        const claim = asClaim(envelope.claim, this.options.deviceId)
        if (claim) this.listeners.claim?.(claim)
        return
      }
      case 'command': {
        const command = asCommand(envelope.command, this.options.deviceId, this.now())
        if (!command) return
        // A hand-off only makes sense if the sender is still online.
        if (command.kind === 'transfer-in') this.listeners.command?.(command)
        else this.listeners.command?.(command)
        return
      }
    }
  }

  private scheduleState(): void {
    if (!this.channel || !this.available || this.stateTimer) return
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null
      if (!this.channel || !this.self) return
      void this.channel.send({ type: 'state', device: this.self }).catch(() => {})
    }, this.stateGapMs)
    this.stateTimer.unref?.()
  }

  private schedulePresence(): void {
    if (!this.channel || !this.available || !this.self) return
    const wait = this.lastPresenceAt + this.presenceGapMs - this.now()
    if (wait <= 0) {
      this.presenceTimer = null
      this.lastPresenceAt = this.now()
      const self = this.self
      void this.channel.track(self).catch(() => {})
      return
    }
    if (this.presenceTimer) return
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null
      if (!this.channel || !this.self) return
      this.lastPresenceAt = this.now()
      const self = this.self
      void this.channel.track(self).catch(() => {})
    }, wait)
    this.presenceTimer.unref?.()
  }

  private emit(): void {
    this.listeners.state?.(this.state())
  }

  private teardown(): void {
    if (this.presenceTimer) clearTimeout(this.presenceTimer)
    if (this.stateTimer) clearTimeout(this.stateTimer)
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.presenceTimer = null
    this.stateTimer = null
    this.heartbeat = null
    const channel = this.channel
    this.channel = null
    this.userId = null
    this.available = false
    this.peers.clear()
    // `self` survives a sign-out so signing back in can publish the player's
    // current state without waiting for the next change.
    this.lastPresenceAt = 0
    this.lastClaimSent = 0
    if (channel) void channel.leave().catch(() => {})
  }
}
