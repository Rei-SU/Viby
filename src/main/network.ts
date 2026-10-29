import { net, powerMonitor } from 'electron'
import type { NetworkState, NetworkStatus, OfflineMode } from '@shared/types'
import { settings } from './settings'

const POLL_MS = 5_000
const RETRY_MS = 2_000
const PROBE_TIMEOUT_MS = 4_000
const PROBE_URL = 'https://music.youtube.com/'

export type NetworkDeps = {
  isOnline: () => boolean
  probe: () => Promise<boolean>
  forcedOffline: () => boolean
  /** Dev/test override (`VIBY_NETWORK_STATE`), independent of the real machine. */
  override?: NetworkStatus | null
}

function envOverride(): NetworkStatus | null {
  const raw = process.env.VIBY_NETWORK_STATE
  return raw === 'online' || raw === 'offline' || raw === 'unreachable' ? raw : null
}

const defaultDeps: NetworkDeps = {
  isOnline: () => net.isOnline(),
  probe: async () => {
    try {
      // A unique URL keeps a cached 200 from masking a link that has since
      // dropped. Any HTTP response still means the path works.
      const res = await net.fetch(`${PROBE_URL}?viby_probe=${Date.now()}`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
      })
      // Any HTTP response means the path works; a 403 is still reachable.
      return res.status >= 100
    } catch {
      return false
    }
  },
  forcedOffline: () => settings().get().offlineMode === 'offline',
  override: envOverride()
}

function manualState(): NetworkState {
  return {
    status: 'offline',
    forcedOffline: true,
    checkedAt: Date.now(),
    detail: 'Offline mode is on.'
  }
}

function severedState(): NetworkState {
  return {
    status: 'offline',
    forcedOffline: false,
    checkedAt: Date.now(),
    detail: 'No network connection.'
  }
}

function unreachableState(): NetworkState {
  return {
    status: 'unreachable',
    forcedOffline: false,
    checkedAt: Date.now(),
    detail: 'Cannot connect to the host right now.'
  }
}

function onlineState(): NetworkState {
  return { status: 'online', forcedOffline: false, checkedAt: Date.now() }
}

/**
 * Connectivity is not a boolean (PLAN §17.3).
 *
 * `net.isOnline()` can only prove that there is no link; a captive portal makes
 * it return true while every request is intercepted. So false is authoritative,
 * while true is confirmed by a tiny request to the host we actually need.
 */
export class NetworkMonitor {
  private state: NetworkState = onlineState()
  private listeners = new Set<(state: NetworkState) => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private probing: Promise<void> | null = null
  private failures = 0
  /** A renderer connectivity event asked to trust the next probe immediately. */
  private forcePending = false
  private started = false
  /** Bumped on every explicit state change so in-flight probes can be ignored. */
  private generation = 0
  private onResume = (): void => {
    void this.check(true)
  }

  constructor(private readonly deps: NetworkDeps = defaultDeps) {}

  start(): void {
    if (this.started) return
    this.started = true

    // Synchronous first read so the window never renders an online Home against
    // a manual offline setting or a dev override while the probe is in flight.
    if (this.deps.forcedOffline()) {
      this.state = manualState()
    } else if (this.deps.override) {
      this.state = this.overrideState(this.deps.override)
    } else if (!this.deps.isOnline()) {
      this.state = severedState()
    }

    powerMonitor.on('resume', this.onResume)
    this.timer = setInterval(() => void this.check(), POLL_MS)
    void this.check(true)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.clearRetry()
    powerMonitor.removeListener('resume', this.onResume)
    this.started = false
  }

  get(): NetworkState {
    return { ...this.state }
  }

  /** No usable link: playback must not wait on the network. */
  isOffline(): boolean {
    return this.state.forcedOffline || this.state.status === 'offline'
  }

  /** Show the local-first layout when the host cannot be reached as well. */
  isLocalFirst(): boolean {
    return this.state.forcedOffline || this.state.status !== 'online'
  }

  onChange(listener: (state: NetworkState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The manual switch writes the setting; the poller owns the rest. */
  setMode(mode: OfflineMode): NetworkState {
    settings().set({ offlineMode: mode })
    // A probe may already be in flight from the poller; this invalidates it so
    // its later result cannot overwrite the switch the user just made.
    this.invalidateProbe()
    if (mode === 'offline') {
      this.set(manualState())
    } else {
      this.state = { ...this.state, forcedOffline: false }
      this.emit()
      void this.check(true)
    }
    return this.get()
  }

  /** A settings write from elsewhere (tests, migration) must take effect too. */
  applySettings(): void {
    const forced = this.deps.forcedOffline()
    if (forced && !this.state.forcedOffline) {
      this.invalidateProbe()
      this.set(manualState())
    } else if (!forced && this.state.forcedOffline) {
      this.invalidateProbe()
      this.state = { ...this.state, forcedOffline: false }
      this.emit()
      void this.check(true)
    }
  }

  /** Exposed for tests that do not want the interval or power hooks. */
  refresh(force = false): Promise<void> {
    return this.check(force)
  }

  private overrideState(status: NetworkStatus): NetworkState {
    if (status === 'offline') return severedState()
    if (status === 'unreachable') return unreachableState()
    return onlineState()
  }

  private async check(force = false): Promise<void> {
    if (this.deps.forcedOffline()) {
      this.invalidateProbe()
      this.set(manualState())
      return
    }

    if (this.state.forcedOffline) {
      this.state = { ...this.state, forcedOffline: false }
      this.emit()
    }

    // A dev override short-circuits the real network so e2e is deterministic.
    if (this.deps.override) {
      this.invalidateProbe()
      this.set(this.overrideState(this.deps.override))
      return
    }

    if (!this.deps.isOnline()) {
      // The link is gone. Any probe still in flight was started against the
      // old network and must not be allowed to report the app back online.
      this.invalidateProbe()
      this.set(severedState())
      return
    }

    if (this.probing) {
      // A renderer `offline`/`online` event arrived while the poller's probe
      // was in flight. Let that probe finish, but trust its failure.
      if (force) this.forcePending = true
      return this.probing
    }

    const gen = this.generation
    this.forcePending = false
    this.clearRetry()
    this.probing = (async () => {
      const reachable = await this.deps.probe()

      // The user switched modes (or the override changed) while the probe was
      // in flight. That decision is newer than this answer, so drop it.
      if (gen !== this.generation) return
      if (this.deps.forcedOffline()) {
        this.set(manualState())
        return
      }

      if (reachable) {
        this.failures = 0
        this.forcePending = false
        this.set(onlineState())
      } else {
        const forced = force || this.forcePending
        this.forcePending = false
        this.failures += 1
        if (forced || this.failures >= 2) {
          this.clearRetry()
          this.set(unreachableState())
        } else if (this.started) {
          // One miss is not enough, but the next poll is five seconds away.
          // Re-probe quickly so a real loss flips the app in about two seconds.
          this.scheduleRetry()
        }
      }
    })().finally(() => {
      this.probing = null
      // A stale probe was invalidated by a newer switch or event. If that
      // newer check was forced while the old probe was still in flight, its
      // request was folded into forcePending; start it now instead of waiting
      // for the next poll.
      if (gen !== this.generation && this.forcePending) {
        this.forcePending = false
        void this.check(true)
      }
    })

    return this.probing
  }

  private scheduleRetry(): void {
    this.clearRetry()
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.check(true)
    }, RETRY_MS)
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private invalidateProbe(): void {
    this.generation += 1
    this.failures = 0
    this.forcePending = false
    this.clearRetry()
  }

  private set(next: NetworkState): void {
    const changed =
      next.status !== this.state.status ||
      next.forcedOffline !== this.state.forcedOffline ||
      next.detail !== this.state.detail
    this.state = next
    if (changed) this.emit()
  }

  private emit(): void {
    const snapshot = this.get()
    for (const listener of this.listeners) listener(snapshot)
  }
}

export const networkMonitor = new NetworkMonitor()
