import type { NetworkState, OfflineMode } from '@shared/types'
import { api } from './api'

/**
 * Connectivity mirrored in the renderer. The main process owns the probe; the
 * UI only decides whether to show the local-first layout.
 */
class NetworkStore {
  state = $state<NetworkState>({
    status: 'online',
    forcedOffline: false,
    checkedAt: 0
  })

  private wired = false

  /** Show downloads-first for "unreachable" as well as a missing link. */
  get localFirst(): boolean {
    return this.state.forcedOffline || this.state.status !== 'online'
  }

  /** Only a missing link or the manual switch should fail playback fast. */
  get offline(): boolean {
    return this.state.forcedOffline || this.state.status === 'offline'
  }

  get label(): string {
    if (this.state.forcedOffline) return 'Offline mode'
    if (this.state.status === 'offline') return 'Offline'
    if (this.state.status === 'unreachable') return "Can't reach YouTube"
    return 'Online'
  }

  get detail(): string {
    if (this.state.forcedOffline) return 'Downloads are available. Go online in Settings.'
    if (this.state.status === 'offline') return 'No network connection.'
    if (this.state.status === 'unreachable') return "Your connection works, but YouTube isn't responding."
    return ''
  }

  async init(): Promise<void> {
    if (this.wired) return
    this.wired = true
    this.state = await api.network.get()
    api.network.onChange((state) => {
      this.state = state
    })
  }

  async setMode(mode: OfflineMode): Promise<void> {
    this.state = await api.network.setMode(mode)
  }
}

export const network = new NetworkStore()
