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
  /** First rejoin delay; doubles up to 30 s. */
  retryBaseMs?: number
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
  /** Rejoin attempts after an error or a closed channel. */
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryAttempt = 0
  /** Presence timestamps in the last 30 s; the server allows five per client. */
  private presenceTimes: number[] = []
  /** Handlers from an older channel must not touch the current one. */
  private generation = 0
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
    this.openChannel(userId)
  }

  private openChannel(userId: string): void {
    if (!this.options.createChannel) {
      this.emit()
      return
    }
    const gen = ++this.generation
    try {
      const created = this.options.createChannel(
        `account:${userId}:devices`,
        this.options.deviceId,
        {
          onDevices: (payloads) => {
            if (gen === this.generation) this.mergePresence(payloads)
          },
          onMessage: (payload) => {
            if (gen === this.generation) this.handleMessage(payload)
          },
          onAvailable: (available) => {
            if (gen === this.generation) this.setAvailable(available)
          }
        }
      )
      if (typeof (created as Promise<ConnectChannel>).then === 'function') {
        void (created as Promise<ConnectChannel>)
          .then((channel) => {
            // The account may have changed while the token was being fetched.
            if (gen !== this.generation || this.userId !== userId) {
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
            if (gen === this.generation && this.userId === userId) this.setAvailable(false)
          })
      } else {
        this.channel = created as ConnectChannel
      }
      this.emit()
    } catch {
      if (gen === this.generation) {
        this.channel = null
        this.setAvailable(false)
      }
    }
  }

  /**
   * An errored or closed channel is recreated with backoff. Without this a
   * single refused join (rate limit, expired token, network blip) left the
   * devices panel empty until the app restarted.
   */
  private scheduleRetry(): void {
    if (this.retryTimer || !this.userId || !this.options.createChannel) return
    const base = this.options.retryBaseMs ?? 2_000
    const delay = Math.min(30_000, base * 2 ** this.retryAttempt)
    this.retryAttempt += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      const userId = this.userId
      if (!userId) return
      const old = this.channel
      this.channel = null
      this.generation += 1
      if (old) void old.leave().catch(() => {})
      this.openChannel(userId)
    }, delay)
    this.retryTimer.unref?.()
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
    if (this.available === available) {
      // A failed first join reports "not available" without a transition; it
      // still needs a retry, otherwise the panel stays empty until relaunch.
      if (!available) this.scheduleRetry()
      return
    }
    this.available = available
    if (!available) this.peers.clear()
    this.emit()
    if (available) {
      this.retryAttempt = 0
      if (this.retryTimer) clearTimeout(this.retryTimer)
      this.retryTimer = null
      // The join is fresh: publish the current snapshot without waiting for
      // the presence gap, then settle into the throttle.
      this.lastPresenceAt = 0
      this.presenceTimes = []
      this.schedulePresence()
      this.scheduleState()
      if (!this.heartbeat) {
        this.heartbeat = setInterval(() => this.schedulePresence(), 30_000)
        this.heartbeat.unref?.()
      }
    } else {
      if (this.heartbeat) clearInterval(this.heartbeat)
      this.heartbeat = null
      if (this.presenceTimer) clearTimeout(this.presenceTimer)
      if (this.stateTimer) clearTimeout(this.stateTimer)
      this.presenceTimer = null
      this.stateTimer = null
      this.scheduleRetry()
    }
  }

  /**
   * Milliseconds until another presence call is allowed. The server enforces
   * five per client per 30 s; four leaves headroom for the join and a retry.
   */
  private presenceGate(): number {
    const now = this.now()
    this.presenceTimes = this.presenceTimes.filter((at) => now - at < 30_000)
    if (this.presenceTimes.length < 4) return 0
    const oldest = this.presenceTimes[0] ?? now
    return 30_000 - (now - oldest) + 100
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
    const now = this.now()
    const wait = Math.max(this.lastPresenceAt + this.presenceGapMs - now, this.presenceGate())
    if (wait <= 0) {
      this.presenceTimer = null
      this.trackPresence()
      return
    }
    if (this.presenceTimer) return
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null
      this.trackPresence()
    }, wait)
    this.presenceTimer.unref?.()
  }

  private trackPresence(): void {
    if (!this.channel || !this.available || !this.self) return
    if (this.presenceGate() > 0) {
      this.schedulePresence()
      return
    }
    const now = this.now()
    this.presenceTimes.push(now)
    this.lastPresenceAt = now
    const self = this.self
    void this.channel.track(self).catch(() => {})
  }

  private emit(): void {
    this.listeners.state?.(this.state())
  }

  private teardown(): void {
    this.generation += 1
    if (this.presenceTimer) clearTimeout(this.presenceTimer)
    if (this.stateTimer) clearTimeout(this.stateTimer)
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.presenceTimer = null
    this.stateTimer = null
    this.heartbeat = null
    this.retryTimer = null
    this.retryAttempt = 0
    this.presenceTimes = []
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
