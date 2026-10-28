import type { ChangelogEntry } from '@shared/types'
import { isNewer } from '@shared/version'
import { api } from './api'

/** More than this and the sheet turns into a wall of text. */
const MAX_VERSIONS = 3

/**
 * The What's New sheet.
 *
 * The notes are baked into the build, so this is purely a local decision:
 * compare the running version with the one whose notes were last shown. An
 * empty value means a first install, where there is nothing to catch up on.
 */
class ChangelogStore {
  open = $state(false)
  /** Newest first; at most MAX_VERSIONS. */
  entries = $state<ChangelogEntry[]>([])
  /** Unseen versions beyond the ones on screen. */
  earlier = $state(0)
  /** The running version, which is what gets marked as seen. */
  current = $state('')
  /** Whether the running version has notes to reopen from Settings. */
  hasCurrent = $state(false)

  private timer: ReturnType<typeof setTimeout> | null = null

  async init(): Promise<void> {
    await this.refresh()
  }

  /** Re-read settings and the baked notes. Also used by the e2e harness. */
  async refresh(): Promise<void> {
    this.clearTimer()
    this.open = false
    this.entries = []
    this.earlier = 0

    try {
      const info = await api.app.changelog()
      this.current = info.version
      this.hasCurrent = info.entries.some((entry) => entry.version === info.version)

      const seen = (await api.settings.get()).lastSeenVersion
      if (!seen) {
        // First install: remember the version so the next update has a baseline.
        await api.settings.set({ lastSeenVersion: info.version })
        return
      }
      if (!isNewer(info.version, seen)) return

      const unseen = info.entries.filter((entry) => isNewer(entry.version, seen))
      if (unseen.length === 0) {
        // The update shipped without notes; do not ask again for this version.
        await api.settings.set({ lastSeenVersion: info.version })
        return
      }

      this.entries = unseen.slice(0, MAX_VERSIONS)
      this.earlier = unseen.length - this.entries.length
      // Let the window paint and the player settle before covering it.
      this.timer = setTimeout(() => {
        this.timer = null
        this.open = true
      }, 450)
    } catch {
      // Notes are a nicety; they must never disturb launch.
    }
  }

  /** Settings > Updates: read the running version's notes again. */
  async showCurrent(): Promise<void> {
    this.clearTimer()
    try {
      const info = await api.app.changelog()
      const entry = info.entries.find((candidate) => candidate.version === info.version)
      if (!entry) return
      this.entries = [entry]
      this.earlier = 0
      this.open = true
    } catch {
      // Nothing to show.
    }
  }

  async dismiss(): Promise<void> {
    if (!this.open) return
    this.clearTimer()
    this.open = false
    this.entries = []
    this.earlier = 0
    if (!this.current) return
    try {
      await api.settings.set({ lastSeenVersion: this.current })
    } catch {
      // A failed write only means the sheet may appear once more.
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

export const changelog = new ChangelogStore()
