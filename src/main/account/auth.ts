import { app } from 'electron'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import type { AccountCredentials, AccountStatus } from '@shared/account'
import { JsonStore, userDataFile } from '../json-store'
import { tokenVault } from './tokens'
import { removeAccountData } from './library-root'

/**
 * Account service.
 *
 * Only the main process ever talks to Supabase. The renderer sees a status
 * object over IPC; it never sees an access token, a refresh token or a session
 * object. PKCE is used for every flow, including magic links, so the verifier
 * never leaves this machine unencrypted.
 */

const SUPABASE_URL = 'https://pnemhyszhbgmhnaudpze.supabase.co'
/** Publishable key: safe to ship, and all it can do is what row-level security allows. */
const SUPABASE_KEY = 'sb_publishable_E7JV-TajoGD6HKektIy4tw_9JCVdNuy'
const STORAGE_KEY = 'viby-account'
/**
 * Emails point at an HTTPS page, not the custom scheme: a server redirect to
 * `viby://` is suppressed by browsers (no user gesture), which left a blank
 * page. The page shows an Open Viby button and then hands over the same link.
 */
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/auth-open`

/** A message that is safe to show in the UI and safe to log. */
export function publicError(error: unknown): string {
  let raw: string
  if (error instanceof Error) raw = error.message
  else if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    raw = (error as { message: string }).message
  } else raw = String(error)
  return (
    raw
      .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300) || 'The account service did not answer. Try again.'
  )
}

/**
 * Supabase error codes that deserve a sentence instead of the raw server
 * wording. The default mail service and the test-address guard are the two a
 * new user hits first.
 */
export function describeAuthError(error: unknown): string {
  const code =
    error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : ''
  switch (code) {
    case 'email_address_invalid':
      return 'Supabase blocks addresses that look like test accounts (for example test…@gmail.com). Use a regular mailbox.'
    case 'email_address_not_authorized':
      return "Supabase's default email service only delivers to members of the project's Supabase organization. Use one of those addresses or set up custom SMTP."
    case 'over_email_send_rate_limit':
      return "Supabase's built-in email service allows only a couple of messages per hour for the whole project. Connect custom SMTP, or turn off Confirm email while testing."
    case 'over_request_rate_limit':
      return 'Too many requests. Wait a few minutes and try again.'
    case 'user_already_exists':
    case 'email_exists':
      return 'An account already uses that address. Sign in instead.'
    case 'weak_password':
      return 'That password is too weak. Use at least 8 characters with a mix of letters and numbers.'
    case 'signup_disabled':
      return 'Sign-ups are disabled on this project.'
    case 'email_provider_disabled':
      return 'Email sign-in is disabled on this project.'
    case 'same_password':
      return 'Choose a password you have not used before.'
    case 'otp_expired':
      return 'That code has expired. Request a new one.'
    case 'otp_disabled':
      return 'Email codes are disabled on this project.'
  }
  return publicError(error)
}

export function signedInStatus(session: Session): AccountStatus {
  return {
    state: 'signed-in',
    email: session.user.email ?? '',
    userId: session.user.id
  }
}

/** A deep link's meaningful parameters, from the query or the hash. */
export type AuthCallback = {
  code: string | null
  tokenHash: string | null
  accessToken: string | null
  refreshToken: string | null
  type: string | null
  error: string | null
}

export function parseAuthCallback(raw: string): AuthCallback | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'viby:') return null

  const params = new URLSearchParams(url.search)
  if (url.hash.length > 1) {
    const hash = new URLSearchParams(url.hash.slice(1))
    for (const [key, value] of hash) if (!params.has(key)) params.set(key, value)
  }

  const error = params.get('error_description') ?? params.get('error')
  return {
    code: params.get('code'),
    tokenHash: params.get('token_hash'),
    accessToken: params.get('access_token'),
    refreshToken: params.get('refresh_token'),
    type: params.get('type'),
    error
  }
}

type PendingFlow = 'signup' | 'magiclink' | 'recovery'
type PendingData = { email: string; recovery: boolean; flow: PendingFlow }

export class AuthManager {
  private client: SupabaseClient | null = null
  private state: AccountStatus = { state: 'signed-out' }
  private listeners = new Set<(status: AccountStatus) => void>()
  private started = false
  private pending: JsonStore<PendingData> | null = null
  /** A recovery link signed us in; the password still has to be replaced. */
  private recovery = false

  private pendingStore(): JsonStore<PendingData> {
    if (!this.pending) {
      this.pending = new JsonStore<PendingData>(userDataFile('account-state.json'), {
        email: '',
        recovery: false,
        flow: 'signup'
      })
    }
    return this.pending
  }

  /** One client for the process; creating it makes no network request. */
  clientInstance(): SupabaseClient {
    if (this.client) return this.client
    const vault = tokenVault()
    this.client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storage: {
          getItem: (key: string) => vault.getItem(key),
          setItem: (key: string, value: string) => vault.setItem(key, value),
          removeItem: (key: string) => vault.removeItem(key)
        },
        storageKey: STORAGE_KEY,
        flowType: 'pkce',
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: true
      },
      global: { headers: { 'X-Client-Info': 'viby-desktop' } }
    })
    return this.client
  }

  /**
   * Restore the last session, if any. Called once after the app is ready; a
   * failure here must leave the app signed out, never block startup.
   */
  async init(): Promise<void> {
    if (this.started) return
    this.started = true
    const client = this.clientInstance()

    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        this.recovery = false
        this.setStatus({ state: 'signed-out' })
        return
      }
      if (session?.user) {
        this.pendingStore().set({ email: '', recovery: this.recovery, flow: 'signup' })
        this.setStatus(
          this.recovery
            ? { state: 'recovery', email: session.user.email ?? '', userId: session.user.id }
            : signedInStatus(session)
        )
      }
    })

    try {
      const { data } = await client.auth.getSession()
      if (data.session?.user) {
        // A recovery link may have signed us in before the app restarted; the
        // flag survives so the new password is still requested.
        this.recovery = this.pendingStore().get().recovery === true
        this.setStatus(
          this.recovery
            ? {
                state: 'recovery',
                email: data.session.user.email ?? '',
                userId: data.session.user.id
              }
            : signedInStatus(data.session)
        )
        return
      }
    } catch {
      // A stored session that cannot be refreshed reads as signed out.
    }
    const email = this.pendingStore().get().email
    this.setStatus(email ? { state: 'pending-verification', email } : { state: 'signed-out' })
  }

  status(): AccountStatus {
    return this.state
  }

  subscribe(callback: (status: AccountStatus) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  async signUp(input: AccountCredentials): Promise<AccountStatus> {
    const client = this.clientInstance()
    const { data, error } = await client.auth.signUp({
      email: input.email,
      password: input.password,
      options: { emailRedirectTo: CALLBACK_URL }
    })
    if (error) throw new Error(describeAuthError(error))

    if (data.session?.user) {
      this.pendingStore().set({ email: '', recovery: false, flow: 'signup' })
      this.setStatus(signedInStatus(data.session))
      return this.state
    }

    // Confirmation is on: the account exists but has no session yet.
    this.pendingStore().set({ email: input.email, recovery: false, flow: 'signup' })
    this.setStatus({ state: 'pending-verification', email: input.email })
    return this.state
  }

  async signIn(input: AccountCredentials): Promise<AccountStatus> {
    const client = this.clientInstance()
    const { data, error } = await client.auth.signInWithPassword({
      email: input.email,
      password: input.password
    })
    if (error) throw new Error(describeAuthError(error))
    if (!data.session?.user) throw new Error('Sign-in did not return a session. Try again.')

    this.pendingStore().set({ email: '', recovery: false, flow: 'signup' })
    this.setStatus(signedInStatus(data.session))
    return this.state
  }

  async sendMagicLink(email: string): Promise<void> {
    const client = this.clientInstance()
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: CALLBACK_URL, shouldCreateUser: false }
    })
    if (error) {
      const message = describeAuthError(error)
      if (/signups not allowed/i.test(publicError(error))) {
        throw new Error('No Viby account uses that address yet. Create one first.')
      }
      throw new Error(message)
    }
    this.pendingStore().set({ email, recovery: false, flow: 'magiclink' })
    this.setStatus({ state: 'pending-verification', email })
  }

  async resetPassword(email: string): Promise<void> {
    const client = this.clientInstance()
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: CALLBACK_URL })
    if (error) throw new Error(describeAuthError(error))
    this.pendingStore().set({ email, recovery: false, flow: 'recovery' })
    this.setStatus({ state: 'pending-verification', email })
  }

  /** Enter the 6-digit code from the pending email. */
  async verifyCode(code: string): Promise<AccountStatus> {
    const pending = this.pendingStore().get()
    if (!pending.email) throw new Error('Request a new code first.')
    const type: 'signup' | 'email' | 'recovery' =
      pending.flow === 'recovery' ? 'recovery' : pending.flow === 'magiclink' ? 'email' : 'signup'

    const client = this.clientInstance()
    const { data, error } = await client.auth.verifyOtp({
      email: pending.email,
      token: code,
      type
    })
    if (error) throw new Error(describeAuthError(error))
    const session = data.session
    if (!session?.user) throw new Error('That code did not sign in. Request a new one.')

    this.pendingStore().set({ email: '', recovery: pending.flow === 'recovery', flow: 'signup' })
    if (pending.flow === 'recovery') {
      this.recovery = true
      this.setStatus({
        state: 'recovery',
        email: session.user.email ?? pending.email,
        userId: session.user.id
      })
    } else {
      this.recovery = false
      this.setStatus(signedInStatus(session))
    }
    return this.state
  }

  /** Send the pending email again, using the flow that created it. */
  async resend(): Promise<void> {
    const pending = this.pendingStore().get()
    if (!pending.email) throw new Error('Request a new code first.')
    if (pending.flow === 'recovery') {
      await this.resetPassword(pending.email)
      return
    }
    const client = this.clientInstance()
    if (pending.flow === 'signup') {
      const { error } = await client.auth.resend({
        type: 'signup',
        email: pending.email,
        options: { emailRedirectTo: CALLBACK_URL }
      })
      if (error) throw new Error(describeAuthError(error))
      return
    }
    await this.sendMagicLink(pending.email)
  }

  async signOut(): Promise<AccountStatus> {
    const client = this.clientInstance()
    this.recovery = false
    try {
      const { error } = await client.auth.signOut()
      if (error) await client.auth.signOut({ scope: 'local' })
    } catch {
      // Offline sign-out still has to clear the local session.
      try {
        await client.auth.signOut({ scope: 'local' })
      } catch {
        // The vault is cleared below either way.
      }
    }
    tokenVault().clear()
    this.pendingStore().set({ email: '', recovery: false, flow: 'signup' })
    this.setStatus({ state: 'signed-out' })
    return this.state
  }

  /** Ask the edge function to erase the server-side account, then sign out here. */
  async deleteAccount(): Promise<void> {
    const client = this.clientInstance()
    const userId =
      this.state.state === 'signed-in' || this.state.state === 'recovery'
        ? this.state.userId
        : null
    const { error } = await client.functions.invoke('delete-account', { method: 'POST' })
    if (error) throw new Error(await functionError(error))
    await this.signOut()
    // The server copy is gone; its local root and sync bookkeeping should not
    // linger for the next account on this machine.
    if (userId) removeAccountData(userId)
  }

  /**
   * Replace the password for the current session. A recovery link signs the user
   * in but leaves the old password in place, so this is the step that actually
   * finishes a reset.
   */
  async updatePassword(password: string): Promise<void> {
    const client = this.clientInstance()
    const { data, error } = await client.auth.updateUser({ password })
    if (error) throw new Error(describeAuthError(error))
    const user = data.user
    if (!user) throw new Error('The password was not accepted. Try again.')
    this.recovery = false
    this.pendingStore().set({ email: '', recovery: false, flow: 'signup' })
    this.setStatus({ state: 'signed-in', email: user.email ?? '', userId: user.id })
  }

  /**
   * Finish a `viby://auth/callback` link. Safe to call before the app is ready:
   * it waits for readiness rather than dropping the link.
   */
  async handleCallback(raw: string): Promise<void> {
    await app.whenReady()
    const parsed = parseAuthCallback(raw)
    if (!parsed) return
    if (parsed.error) throw new Error(publicError(parsed.error))

    // The link says whether this sign-in is a reset; a reset requested in the
    // app also leaves that intent in the pending record. Remember it before the
    // auth client emits SIGNED_IN so that event cannot hide the recovery step.
    const pending = this.pendingStore().get()
    if (parsed.type === 'recovery' || pending.flow === 'recovery') this.recovery = true

    const client = this.clientInstance()

    if (parsed.code) {
      const { data, error } = await client.auth.exchangeCodeForSession(parsed.code)
      if (error) throw new Error(describeAuthError(error))
      if (data.session?.user) this.applyCallbackSession(data.session)
      return
    }

    if (parsed.accessToken && parsed.refreshToken) {
      const { data, error } = await client.auth.setSession({
        access_token: parsed.accessToken,
        refresh_token: parsed.refreshToken
      })
      if (error) throw new Error(describeAuthError(error))
      if (data.session?.user) this.applyCallbackSession(data.session)
      return
    }

    if (parsed.tokenHash && parsed.type) {
      const type = parsed.type as 'magiclink' | 'recovery' | 'email' | 'signup' | 'invite'
      const { data, error } = await client.auth.verifyOtp({
        token_hash: parsed.tokenHash,
        type
      })
      if (error) throw new Error(describeAuthError(error))
      if (data.session?.user) this.applyCallbackSession(data.session)
      return
    }
  }

  private applyCallbackSession(session: Session): void {
    this.pendingStore().set({ email: '', recovery: this.recovery, flow: 'signup' })
    this.setStatus(
      this.recovery
        ? { state: 'recovery', email: session.user.email ?? '', userId: session.user.id }
        : signedInStatus(session)
    )
  }

  private setStatus(next: AccountStatus): void {
    if (JSON.stringify(next) === JSON.stringify(this.state)) return
    this.state = next
    for (const listener of this.listeners) {
      try {
        listener(next)
      } catch {
        // A listener must not be able to break auth state transitions.
      }
    }
  }
}

/** Edge functions answer with a JSON body; prefer its message over the generic one. */
async function functionError(error: unknown): Promise<string> {
  const context = (error as { context?: { json?: () => Promise<unknown>; status?: number } })
    .context
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.json()) as { error?: unknown }
      if (body && typeof body.error === 'string' && body.error.length > 0) {
        return publicError(body.error)
      }
    } catch {
      // Fall through to the generic message.
    }
  }
  return publicError(error)
}

let manager: AuthManager | null = null

export function auth(): AuthManager {
  if (!manager) manager = new AuthManager()
  return manager
}

/** Startup hook: restore the last session without waiting on the network. */
export function initAccount(): void {
  void auth()
    .init()
    .catch((error: unknown) => {
      console.warn('[account] session restore failed:', publicError(error))
    })
}

/** Deep-link entry point shared with the protocol handler. */
export function handleAuthCallback(raw: string): void {
  void auth()
    .handleCallback(raw)
    .catch((error: unknown) => {
      console.warn('[account] sign-in link failed:', publicError(error))
    })
}
