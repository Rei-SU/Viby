import type { ChangelogEntry } from '@shared/types'
import { unseenEntries } from '@shared/changelog'
import { isNewer } from '@shared/version'
import { api } from './api'

/** More than this and the sheet turns into a wall of text. */
const MAX_VERSIONS = 3

/**
 * The What's New sheet.
 *
 * The notes are baked into the build, so this is purely a local decision:
 * compare the running version with the one whose notes were last shown. The
 * rules live in `@shared/changelog` so they can be tested without a window.
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

      const settings = await api.settings.get()
      const unseen = unseenEntries(
        info.entries,
        settings.lastSeenVersion,
        settings.lastShownVersion,
        info.firstRun
      )

      if (info.firstRun) {
        // Nothing to catch up on. Record both values so the next update is a
        // normal one instead of looking like another first install.
        await api.settings.set({
          lastSeenVersion: info.version,
          lastShownVersion: info.version
        })
        return
      }

      if (unseen.length === 0) {
        // Up to date, or this release shipped without notes: advance the
        // baseline so it is not asked about again.
        if (isNewer(info.version, settings.lastSeenVersion)) {
          await api.settings.set({
            lastSeenVersion: info.version,
            lastShownVersion: info.version
          })
        }
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
      // Reading the running version's notes catches this install up.
      await api.settings.set({
        lastSeenVersion: info.version,
        lastShownVersion: info.version
      })
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
      await api.settings.set({
        lastSeenVersion: this.current,
        lastShownVersion: this.current
      })
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
