import type { UpdateState } from '@shared/types'
import { api } from './api'

/**
 * Update state shared by Settings and the sidebar indicator. The main process
 * owns checking and downloading; this is a mirror, subscribed once.
 */
class UpdateStore {
  state = $state<UpdateState | null>(null)

  private wired = false

  /** Something the user should notice, excluding versions they skipped. */
  get pending(): boolean {
    const state = this.state
    if (!state || state.skipped) return false
    return state.phase === 'available' || state.phase === 'ready' || state.phase === 'manual'
  }

  init(): void {
    if (this.wired) return
    this.wired = true

    // Subscribe before reading so a broadcast that lands mid-flight wins.
    let changed = false
    api.updates.onChange((state) => {
      changed = true
      this.state = state
    })
    void api.updates.get().then((state) => {
      if (!changed) this.state = state
    })
  }

  async check(): Promise<void> {
    this.state = await api.updates.check()
  }

  async download(): Promise<void> {
    try {
      this.state = await api.updates.download()
    } catch {
      // The Windows updater quits as soon as the download verifies, so the IPC
      // reply may never reach this frame. That is the intended outcome.
    }
  }

  async cancel(): Promise<void> {
    // The reply describes the pre-abort state; the download's own result (and
    // the broadcast) carries the settled one, so don't copy it over.
    await api.updates.cancel()
  }

  async install(): Promise<void> {
    try {
      this.state = await api.updates.install()
    } catch {
      // The app may quit (Windows install, macOS manual) before the reply
      // reaches this frame; that is the intended outcome, not an error.
    }
  }
}

export const updates = new UpdateStore()
