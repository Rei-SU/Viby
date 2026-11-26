import type {
  AccountApi,
  AccountCredentials,
  AccountExport,
  AccountStatus,
  SyncApi,
  SyncStatus
} from '@shared/account'
import type { Result } from '@shared/types'
import { api } from './api'

const SIGNED_OUT: AccountStatus = { state: 'signed-out' }
const IDLE_SYNC: SyncStatus = {
  phase: 'idle',
  lastSyncedAt: null,
  pending: 0,
  conflicts: 0,
  error: null
}
const UNAVAILABLE = 'The account service is unavailable in this build.'

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  return fallback
}

/** "just now", "4 min ago", … for the last completed sync. */
export function relativeTime(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(ms)
}

/**
 * One plain sentence for the sync engine's state. Shared by the docked sheet
 * and the settings row so the two never drift apart.
 */
export function syncSummary(status: SyncStatus): string {
  const changes = (count: number): string => `${count} ${count === 1 ? 'change' : 'changes'}`
  const replaced =
    status.conflicts > 0
      ? ` ${status.conflicts} ${status.conflicts === 1 ? 'change was' : 'changes were'} replaced by another device.`
      : ''
  if (status.phase === 'syncing') {
    return status.pending > 0
      ? `Syncing ${changes(status.pending)}…`
      : 'Checking for changes…'
  }
  if (status.phase === 'error') {
    return status.error || 'Sync stopped. Your changes are still saved on this device.'
  }
  if (status.phase === 'offline') {
    return status.pending > 0
      ? `Offline. ${changes(status.pending)} waiting until you reconnect.`
      : 'Offline. Changes stay on this device until you reconnect.'
  }
  if (status.pending > 0) return `${changes(status.pending)} waiting to sync.${replaced}`
  if (status.lastSyncedAt) return `Last synced ${relativeTime(status.lastSyncedAt)}.${replaced}`
  return `Ready to sync.${replaced}`
}

/**
 * The renderer's view of the optional account layer.
 *
 * Everything that matters lives in main: tokens never reach this process, and
 * signed out means no network call at all. This store mirrors the pushed state
 * so every surface (avatar, sheet, settings) agrees, and it keeps the sheet's
 * open flag here rather than in App so the settings view can open it too.
 *
 * Nothing here runs at import time. `init()` only subscribes and asks for the
 * current status, and it is called from a mount effect; a slow or broken
 * account service must never delay startup or playback.
 */
class AccountStore {
  status = $state<AccountStatus>({ state: 'signed-out' })
  sync = $state<SyncStatus>({
    phase: 'idle',
    lastSyncedAt: null,
    pending: 0,
    conflicts: 0,
    error: null
  })
  open = $state(false)

  private started = false
  private disposers: (() => void)[] = []

  get signedIn(): boolean {
    return this.status.state === 'signed-in'
  }

  get email(): string {
    return this.status.state === 'signed-out' ? '' : this.status.email
  }

  /** First letter of the address, for the avatar button. */
  get initial(): string {
    const address = this.email.trim()
    return address ? address[0].toUpperCase() : ''
  }

  init(): void {
    if (this.started) return
    this.started = true
    const bridge = this.bridge()
    if (!bridge) return

    try {
      this.disposers.push(
        bridge.account.onChange((next) => {
          this.status = next
          // A reset link lands here: open the sheet so the new password can be set.
          if (next.state === 'recovery') this.open = true
        })
      )
      this.disposers.push(bridge.sync.onChange((next) => (this.sync = next)))
    } catch {
      // A bridge that cannot subscribe is treated like a missing one.
      return
    }

    void this.refresh()
  }

  dispose(): void {
    for (const off of this.disposers) {
      try {
        off()
      } catch {
        // Unsubscribing is best-effort; the app is shutting down anyway.
      }
    }
    this.disposers = []
    this.started = false
  }

  async refresh(): Promise<void> {
    const bridge = this.bridge()
    if (!bridge) return
    try {
      const [status, sync] = await Promise.all([bridge.account.status(), bridge.sync.status()])
      this.status = status
      this.sync = sync
      if (status.state === 'recovery') this.open = true
    } catch {
      // Signed out is the safe fallback; the sheet still opens and retries.
    }
  }

  show(): void {
    this.open = true
  }

  close(): void {
    this.open = false
  }

  toggle(): void {
    this.open = !this.open
  }

  async signUp(input: AccountCredentials): Promise<Result<AccountStatus>> {
    return this.statusCall((account) => account.signUp(input))
  }

  async signIn(input: AccountCredentials): Promise<Result<AccountStatus>> {
    return this.statusCall((account) => account.signIn(input))
  }

  async verifyCode(code: string): Promise<Result<AccountStatus>> {
    return this.statusCall((account) => account.verifyCode(code))
  }

  async resend(): Promise<Result<void>> {
    const bridge = this.bridge()
    if (!bridge) return { ok: false, error: UNAVAILABLE }
    try {
      return await bridge.account.resend()
    } catch (err) {
      return { ok: false, error: messageOf(err, 'Could not send another code.') }
    }
  }

  async sendMagicLink(email: string): Promise<Result<void>> {
    const bridge = this.bridge()
    if (!bridge) return { ok: false, error: UNAVAILABLE }
    const address = email.trim()
    try {
      const result = await bridge.account.sendMagicLink(address)
      // The address was accepted; show the inbox panel without waiting for the
      // push. A later `account:changed` with the same state is harmless.
      if (result.ok) this.status = { state: 'pending-verification', email: address }
      return result
    } catch (err) {
      return { ok: false, error: messageOf(err, 'Could not send the sign-in link.') }
    }
  }

  async resetPassword(email: string): Promise<Result<void>> {
    const bridge = this.bridge()
    if (!bridge) return { ok: false, error: UNAVAILABLE }
    try {
      return await bridge.account.resetPassword(email.trim())
    } catch (err) {
      return { ok: false, error: messageOf(err, 'Could not send the reset link.') }
    }
  }

  async signOut(): Promise<Result<AccountStatus>> {
    return this.statusCall((account) => account.signOut())
  }

  async deleteAccount(): Promise<Result<void>> {
    const bridge = this.bridge()
    if (!bridge) return { ok: false, error: UNAVAILABLE }
    try {
      const result = await bridge.account.deleteAccount()
      if (result.ok) {
        this.status = SIGNED_OUT
        this.sync = IDLE_SYNC
      }
      return result
    } catch (err) {
      return { ok: false, error: messageOf(err, 'Could not delete the account.') }
    }
  }

  async updatePassword(password: string): Promise<Result<void>> {
    const bridge = this.bridge()
    if (!bridge) return { ok: false, error: UNAVAILABLE }
    try {
      const result = await bridge.account.updatePassword(password)
      if (result.ok && this.status.state === 'recovery') {
        this.status = {
          state: 'signed-in',
          email: this.status.email,
          userId: this.status.userId
        }
      }
      return result
    } catch (err) {
      return { ok: false, error: messageOf(err, 'Could not set the new password.') }
    }
  }

  async exportLibrary(): Promise<Result<AccountExport>> {
    const bridge = this.bridge()
    if (!bridge) return { ok: false, error: UNAVAILABLE }
    try {
      return await bridge.account.export()
    } catch (err) {
      return { ok: false, error: messageOf(err, 'Could not write the export file.') }
    }
  }

  /** Resolves with the status the engine settled on; never rejects. */
  async syncNow(): Promise<Result<SyncStatus>> {
    const bridge = this.bridge()
    if (!bridge) return { ok: false, error: UNAVAILABLE }
    try {
      const next = await bridge.sync.now()
      this.sync = next
      return { ok: true, data: next }
    } catch (err) {
      const error = messageOf(err, 'Sync could not start.')
      this.sync = { ...this.sync, phase: 'error', error }
      return { ok: false, error }
    }
  }

  private bridge(): { account: AccountApi; sync: SyncApi } | null {
    // The preload bridge is typed as always present, but the account layer is
    // optional; a build without it must degrade to "signed out", not crash.
    if (!api.account || !api.sync) return null
    return { account: api.account, sync: api.sync }
  }

  private async statusCall(
    run: (account: AccountApi) => Promise<Result<AccountStatus>>
  ): Promise<Result<AccountStatus>> {
    const bridge = this.bridge()
    if (!bridge) return { ok: false, error: UNAVAILABLE }
    try {
      const result = await run(bridge.account)
      if (result.ok) this.status = result.data
      return result
    } catch (err) {
      return { ok: false, error: messageOf(err, 'Could not reach the account service.') }
    }
  }
}

export const account = new AccountStore()
