import type { UpdateState } from '@shared/types'
import { isNewer } from './version'

/** Signature or digest verification failed: never install past this. */
export class UpdateIntegrityError extends Error {}

export type ReleaseInfo = {
  version: string
  /** Human-facing release page. */
  url: string
  /** Direct installer for this machine, when the release has one. */
  installerUrl?: string
  /** Expected sha256 (hex) from the GitHub asset digest, when reported. */
  installerSha256?: string
  /**
   * `name -> sha256` from the Ed25519-signed manifest, when the release carries
   * one. Preferred over the GitHub digest: it is pinned to a key in the app, so
   * a compromised GitHub account cannot forge it.
   */
  artifacts?: Record<string, string>
  /** Internal: where the signed manifest lives, if the release has one. */
  manifestUrl?: string
}

/** Windows: electron-updater + NSIS, which installs per-user (no admin). */
export type NativeUpdater = {
  /** The newer version, or null when already up to date. */
  check(): Promise<string | null>
  download(
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
    expectedSha256?: string
  ): Promise<void>
  install(): void
}

export type UpdaterDeps = {
  currentVersion: string
  offline: () => boolean
  /** Public release feed. Used by macOS, and for update metadata on Windows. */
  latestRelease: () => Promise<ReleaseInfo>
  /** Present only where in-place installs are possible (packaged Windows). */
  native?: NativeUpdater
  /** macOS: download and open the installer, returning a user-facing note. */
  downloadManual?: (
    release: ReleaseInfo,
    onProgress: (fraction: number) => void,
    signal: AbortSignal
  ) => Promise<string>
  /** Quit so the user can replace the app (macOS manual updates only). */
  quit?: () => void
  /** The version the user asked not to be offered again. */
  skippedVersion?: () => string
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
  private controller: AbortController | null = null

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

    // Never let a previous release's artifact hash authorize a new download.
    this.release = null
    this.set({
      phase: 'checking',
      version: undefined,
      message: undefined,
      progress: undefined,
      skipped: false
    })

    const skipped = this.deps.skippedVersion?.() ?? ''

    try {
      if (this.deps.native) {
        const version = await this.deps.native.check()
        if (!version) return this.set({ phase: 'up-to-date', checkedAt: Date.now() })
        if (skipped && version === skipped) return this.skippedState(version)

        // The pinned manifest is required, not optional: latest.yml alone only
        // proves GitHub served the bytes it hosts. A missing manifest must fail
        // closed rather than silently downgrade to an unsigned install.
        const release = await this.deps.latestRelease()
        if (release.version !== version) {
          throw new UpdateIntegrityError(
            'The signed update manifest does not match the available version.'
          )
        }
        if (!release.artifacts?.['Viby-windows-x64.exe']) {
          throw new UpdateIntegrityError('The signed update manifest is missing the Windows installer.')
        }
        this.release = release
        return this.set({ phase: 'available', version, checkedAt: Date.now() })
      }

      const release = await this.deps.latestRelease()
      this.release = release
      const newer = isNewer(release.version, this.deps.currentVersion)
      if (!newer) return this.set({ phase: 'up-to-date', version: undefined, checkedAt: Date.now() })
      if (skipped && release.version === skipped) return this.skippedState(release.version)

      // A release can exist without an installer for this machine (a Windows-only
      // release, or a partially failed asset upload). Say so instead of offering
      // a download that cannot work.
      if (!release.installerUrl) {
        const message = `Version ${release.version} has no installer for this Mac yet.`
        return options.quiet ? this.set(previous) : this.fail(message)
      }
      return this.set({ phase: 'available', version: release.version, checkedAt: Date.now() })
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

    const controller = new AbortController()
    this.controller = controller
    this.set({ phase: 'downloading', progress: 0, message: undefined, skipped: false })

    try {
      if (this.deps.native) {
        const expected = this.release?.artifacts?.['Viby-windows-x64.exe']
        if (!expected) {
          throw new UpdateIntegrityError(
            'No signed installer hash is available. Check for updates again.'
          )
        }
        await this.deps.native.download(
          (fraction) => {
            this.set({ phase: 'downloading', progress: clamp(fraction) })
          },
          controller.signal,
          expected
        )
        return this.set({ phase: 'ready', progress: 1 })
      }

      const release = this.release
      if (!this.deps.downloadManual || !release) {
        return this.fail('Check for updates again before downloading.')
      }
      const note = await this.deps.downloadManual(
        release,
        (fraction) => {
          this.set({ phase: 'downloading', progress: clamp(fraction) })
        },
        controller.signal
      )
      return this.set({ phase: 'manual', progress: 1, message: note })
    } catch (error) {
      if (controller.signal.aborted) {
        return this.set({
          phase: 'available',
          version: this.state.version,
          progress: undefined,
          message: 'Download cancelled.'
        })
      }
      return this.fail(messageFor(error))
    } finally {
      if (this.controller === controller) this.controller = null
    }
  }

  /** Abort a transfer. The state returns to `available` when it unwinds. */
  cancel(): UpdateState {
    if (this.state.phase === 'downloading') this.controller?.abort()
    return this.state
  }

  install(): UpdateState {
    // macOS: the user must quit before replacing the app, so the manual phase
    // offers "Quit Viby" through this same channel.
    if (this.state.phase === 'manual') {
      this.deps.quit?.()
      return this.state
    }
    if (this.state.phase !== 'ready' || !this.deps.native) return this.state
    this.deps.native.install()
    return this.state
  }

  private skippedState(version: string): UpdateState {
    return this.set({
      phase: 'up-to-date',
      version: undefined,
      skipped: true,
      checkedAt: Date.now(),
      message: `Version ${version} is skipped.`
    })
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
