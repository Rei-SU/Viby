import type { UpdateState } from '@shared/types'
import { isNewer } from './version'

export type ReleaseInfo = {
  version: string
  /** Human-facing release page. */
  url: string
  /** Direct installer for this machine, when the release has one. */
  installerUrl?: string
  /** Expected sha256 (hex) of the installer, when GitHub reports one. */
  installerSha256?: string
}

/** Windows: electron-updater + NSIS, which installs per-user (no admin). */
export type NativeUpdater = {
  /** The newer version, or null when already up to date. */
  check(): Promise<string | null>
  download(onProgress: (fraction: number) => void): Promise<void>
  install(): void
}

export type UpdaterDeps = {
  currentVersion: string
  offline: () => boolean
  /** Public release feed. Used by macOS, and by unpackaged builds. */
  latestRelease: () => Promise<ReleaseInfo>
  /** Present only where in-place installs are possible (packaged Windows). */
  native?: NativeUpdater
  /** macOS: download and open the installer, returning a user-facing note. */
  downloadManual?: (release: ReleaseInfo, onProgress: (fraction: number) => void) => Promise<string>
  onState: (state: UpdateState) => void
}

/**
 * Update state machine, independent of Electron and electron-updater so it can
 * be tested with fakes (`tests/updates.test.ts`). The platform adapters decide
 * *how* an update happens; this class decides *when* and what the user sees.
 */
export class Updater {
  private state: UpdateState
  private release: ReleaseInfo | null = null

  constructor(private readonly deps: UpdaterDeps) {
    this.state = {
      phase: 'idle',
      currentVersion: deps.currentVersion,
      canInstall: deps.native !== undefined
    }
  }

  get(): UpdateState {
    return this.state
  }

  async check(options: { quiet?: boolean } = {}): Promise<UpdateState> {
    const previous = this.state
    // A check cannot interrupt a transfer, and overlapping checks would race
    // their results into the same state.
    if (this.state.phase === 'checking' || this.state.phase === 'downloading') return this.state

    if (this.deps.offline()) {
      return options.quiet ? previous : this.fail("You're offline. Connect to the internet to check for updates.")
    }
    if (!this.deps.native && !this.deps.downloadManual) {
      return options.quiet ? previous : this.fail('Updates are only available in the packaged app.')
    }

    this.set({ phase: 'checking', version: undefined, message: undefined, progress: undefined })

    try {
      if (this.deps.native) {
        const version = await this.deps.native.check()
        if (!version) return this.set({ phase: 'up-to-date', checkedAt: Date.now() })
        return this.set({ phase: 'available', version, checkedAt: Date.now() })
      }

      const release = await this.deps.latestRelease()
      this.release = release
      const newer = isNewer(release.version, this.deps.currentVersion)
      return this.set({
        phase: newer ? 'available' : 'up-to-date',
        version: newer ? release.version : undefined,
        checkedAt: Date.now()
      })
    } catch (error) {
      // A background check must never turn Settings red because GitHub was
      // briefly unreachable; it leaves the last known state alone.
      return options.quiet ? this.set(previous) : this.fail(messageFor(error))
    }
  }

  async download(): Promise<UpdateState> {
    if (this.state.phase === 'downloading') return this.state
    // `manual` is retryable: the DMG may have been closed or deleted.
    if (this.state.phase !== 'available' && this.state.phase !== 'manual') return this.state

    this.set({ phase: 'downloading', progress: 0, message: undefined })

    try {
      if (this.deps.native) {
        await this.deps.native.download((fraction) => {
          this.set({ phase: 'downloading', progress: clamp(fraction) })
        })
        return this.set({ phase: 'ready', progress: 1 })
      }

      const release = this.release
      if (!this.deps.downloadManual || !release) {
        return this.fail('Check for updates again before downloading.')
      }
      const note = await this.deps.downloadManual(release, (fraction) => {
        this.set({ phase: 'downloading', progress: clamp(fraction) })
      })
      return this.set({ phase: 'manual', progress: 1, message: note })
    } catch (error) {
      return this.fail(messageFor(error))
    }
  }

  install(): UpdateState {
    // macOS has nothing to install: the renderer never offers this action
    // there, but the handler must stay harmless.
    if (this.state.phase !== 'ready' || !this.deps.native) return this.state
    this.deps.native.install()
    return this.state
  }

  private set(patch: Partial<UpdateState>): UpdateState {
    this.state = { ...this.state, ...patch }
    this.deps.onState(this.state)
    return this.state
  }

  private fail(message: string): UpdateState {
    return this.set({ phase: 'error', message, progress: undefined })
  }
}

function clamp(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0
  return Math.min(1, Math.max(0, fraction))
}

/** electron-updater throws with long multi-line messages; keep the first line. */
function messageFor(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const firstLine = raw.split('\n').map((line) => line.trim()).find(Boolean)
  return firstLine ?? 'Could not check for updates.'
}
