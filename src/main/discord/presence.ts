import type { PresenceSnapshot } from '@shared/types'
import { buildActivity, type DiscordActivity } from './activity'
import { DiscordIpcClient } from './client'
import { UpdateRateLimiter } from './rate-limit'

const DEFAULT_RETRY_DELAYS = [30_000, 60_000, 120_000, 300_000]

export type PresenceClient = {
  readonly isReady: boolean
  open(): Promise<void>
  setActivity(activity: DiscordActivity | null): Promise<void>
  close(): void
  onClose(handler: () => void): void
}

export type DiscordPresenceOptions = {
  clientId: string
  paths: string[]
  createClient?: (clientId: string, paths: string[]) => PresenceClient
  now?: () => number
  retryDelays?: number[]
  updateLimit?: number
  updateWindowMs?: number
  /** Animated badge URL; tests and dev runs can point it at a reachable copy. */
  badgeUrl?: string
}

/**
 * Owns the Discord connection and the latest player snapshot. Updates are
 * coalesced: the newest state wins, and only the final state is sent once the
 * rate-limit window allows it. Paused/stopped snapshots build a null activity,
 * which clears the presence.
 */
export class DiscordPresence {
  private enabled = false
  private client: PresenceClient | null = null
  private connecting = false
  private snapshot: PresenceSnapshot | null = null
  private lastActivity = ''
  private retryIndex = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private sendTimer: ReturnType<typeof setTimeout> | null = null
  private readonly now: () => number
  private readonly limiter: UpdateRateLimiter

  constructor(private readonly options: DiscordPresenceOptions) {
    this.now = options.now ?? Date.now
    this.limiter = new UpdateRateLimiter(
      options.updateLimit ?? 5,
      options.updateWindowMs ?? 20_000,
      this.now
    )
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    if (!enabled) {
      this.shutdown()
      return
    }
    this.retryIndex = 0
    void this.connect()
  }

  update(snapshot: PresenceSnapshot): void {
    if (!this.enabled || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return
    }
    this.snapshot = snapshot
    this.schedule()
  }

  stop(): void {
    this.enabled = false
    this.shutdown()
  }

  private connect(): void {
    if (!this.enabled || this.connecting || this.client?.isReady) return
    this.connecting = true
    const client = this.options.createClient
      ? this.options.createClient(this.options.clientId, this.options.paths)
      : new DiscordIpcClient({ clientId: this.options.clientId, paths: this.options.paths })
    client.onClose(() => this.handleClose(client))

    void client
      .open()
      .then(() => {
        this.connecting = false
        if (!this.enabled || this.client) {
          client.close()
          return
        }
        this.client = client
        this.retryIndex = 0
        this.limiter.reset()
        this.lastActivity = ''
        this.schedule()
      })
      .catch((error: unknown) => {
        this.connecting = false
        client.close()
        console.warn(
          '[discord] could not connect:',
          error instanceof Error ? error.message : String(error)
        )
        this.scheduleRetry()
      })
  }

  private handleClose(client: PresenceClient): void {
    if (this.client !== client) return
    this.client = null
    this.lastActivity = ''
    if (!this.enabled) return
    console.warn('[discord] disconnected; retrying')
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    if (!this.enabled || this.retryTimer) return
    const delays = this.options.retryDelays ?? DEFAULT_RETRY_DELAYS
    const delay = delays[Math.min(this.retryIndex, delays.length - 1)]
    this.retryIndex += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.connect()
    }, delay)
    this.retryTimer.unref?.()
  }

  private schedule(): void {
    if (!this.enabled || !this.client?.isReady || this.sendTimer) return
    const wait = this.limiter.delay()
    if (wait > 0) {
      this.sendTimer = setTimeout(() => {
        this.sendTimer = null
        void this.flush()
      }, wait)
      this.sendTimer.unref?.()
      return
    }
    void this.flush()
  }

  private async flush(): Promise<void> {
    const client = this.client
    if (!this.enabled || !client?.isReady || !this.snapshot) return

    const activity = buildActivity(this.snapshot, this.now(), this.options.badgeUrl)
    const key = activity ? JSON.stringify(activity) : 'null'
    // Nothing to say yet: do not clear an activity that was never shown.
    if (!activity && this.lastActivity === '') return
    if (key === this.lastActivity) return

    this.limiter.record()
    try {
      await client.setActivity(activity)
      this.lastActivity = key
    } catch (error) {
      console.warn(
        '[discord] activity update failed:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  private shutdown(): void {
    if (this.sendTimer) clearTimeout(this.sendTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.sendTimer = null
    this.retryTimer = null

    const client = this.client
    this.client = null
    this.connecting = false
    this.snapshot = null
    this.lastActivity = ''
    this.retryIndex = 0
    this.limiter.reset()
    client?.close()
  }
}
