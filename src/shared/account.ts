import type { Result } from './types'

/**
 * Channel names for the optional account and sync layer.
 *
 * Kept separate from `CH` in `./ipc` so the whole account surface, its types and
 * its channel list live in one file; `CH` re-uses these keys and therefore reads
 * `CH.accountStatus`, `CH.syncNow` and so on.
 */
export const ACCOUNT_CH = {
  accountStatus: 'account:status',
  accountSignUp: 'account:sign-up',
  accountSignIn: 'account:sign-in',
  accountVerifyCode: 'account:verify-code',
  accountResend: 'account:resend',
  accountMagicLink: 'account:magic-link',
  accountResetPassword: 'account:reset-password',
  accountSignOut: 'account:sign-out',
  accountDelete: 'account:delete',
  accountExport: 'account:export',
  accountUpdatePassword: 'account:update-password',
  accountChanged: 'account:changed',

  syncStatus: 'sync:status',
  syncNow: 'sync:now',
  syncConflicts: 'sync:conflicts',
  syncClearConflicts: 'sync:clear-conflicts',
  syncChanged: 'sync:changed'
} as const

/** Where the user stands with the optional account service. */
export type AccountStatus =
  | { state: 'signed-out' }
  /** The address was accepted; the user still has to click the emailed link. */
  | { state: 'pending-verification'; email: string }
  | { state: 'signed-in'; email: string; userId: string }
  /**
   * A password-reset link was followed and the session exists, but the password
   * has not been replaced yet. Sync stays stopped until it is.
   */
  | { state: 'recovery'; email: string; userId: string }

/** What the sync engine is doing right now. Pushed, never polled. */
export type SyncPhase = 'idle' | 'syncing' | 'error' | 'offline'

export type SyncStatus = {
  phase: SyncPhase
  /** Epoch milliseconds of the last completed pull-plus-push, or null. */
  lastSyncedAt: number | null
  /** Records waiting in the outbox. */
  pending: number
  /** Replaced local edits recorded for this account, awaiting review. */
  conflicts: number
  /** Human-readable reason for the `error` phase; null otherwise. */
  error: string | null
}

export type SyncConflict = {
  at: number
  kind: string
  recordId: string
}

/** Email and password, for both sign-up and sign-in. */
export type AccountCredentials = {
  email: string
  password: string
}

/** The JSON dump written for a signed-in account. */
export type AccountExport = {
  exportedAt: number
  email: string
  userId: string
  /** Absolute path of the file that was written. */
  path: string
}

/** Account actions reachable from the renderer. */
export interface AccountApi {
  status(): Promise<AccountStatus>
  signUp(input: AccountCredentials): Promise<Result<AccountStatus>>
  signIn(input: AccountCredentials): Promise<Result<AccountStatus>>
  /** Verify the 6-digit code from the current pending email. */
  verifyCode(code: string): Promise<Result<AccountStatus>>
  /** Send the pending email again (signup, sign-in or reset). */
  resend(): Promise<Result<void>>
  /** Email a sign-in link; the app finishes it through `viby://auth/callback`. */
  sendMagicLink(email: string): Promise<Result<void>>
  /** Email a password-reset link. */
  resetPassword(email: string): Promise<Result<void>>
  signOut(): Promise<Result<AccountStatus>>
  /** Erase the account and its synced library on the server, then sign out. */
  deleteAccount(): Promise<Result<void>>
  /** Replace the password for the signed-in or recovering session. */
  updatePassword(password: string): Promise<Result<void>>
  /** Write the account's local library to a JSON file the user can keep. */
  export(): Promise<Result<AccountExport>>
  /** Sign-in state changed, including after a deep link or a token refresh. */
  onChange(callback: (status: AccountStatus) => void): () => void
}

/** Sync actions reachable from the renderer. */
export interface SyncApi {
  status(): Promise<SyncStatus>
  /** Ask for a sync now; resolves with the state once it settles. */
  now(): Promise<SyncStatus>
  /** Local edits that a newer remote copy replaced, newest first. */
  conflicts(): Promise<SyncConflict[]>
  /** Acknowledge and clear the conflict log for this account. */
  clearConflicts(): Promise<void>
  onChange(callback: (status: SyncStatus) => void): () => void
}
