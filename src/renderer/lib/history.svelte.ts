import type { HistoryEntry } from '@shared/types'
import { untrack } from 'svelte'
import { api } from './api'

/**
 * The listening history, shared by the Home card and the side panel so both
 * render the same rows without two independent reads. Entries are already
 * newest-first from main.
 */
class HistoryStore {
  entries = $state<HistoryEntry[]>([])
  loading = $state(false)

  private loadedAt = 0
  private request = 0

  async load(force = false): Promise<void> {
    // Home loads this from an effect; reading `entries` there would make every
    // response re-trigger the effect and invalidate the request that set it.
    const fresh =
      !force && untrack(() => this.entries.length > 0 && Date.now() - this.loadedAt < 5000)
    if (fresh) return

    const request = ++this.request
    if (untrack(() => this.entries.length === 0)) this.loading = true
    try {
      const list = await api.history.list(100)
      if (request !== this.request) return
      this.entries = list
      this.loadedAt = Date.now()
    } catch {
      // History is context, not a blocker; the previous list stays.
    } finally {
      if (request === this.request) this.loading = false
    }
  }
}

export const history = new HistoryStore()
