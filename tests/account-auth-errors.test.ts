/**
 * Account error wording: server codes map to a sentence the user can act on.
 * Run: node tests/unit.mjs account-auth-errors
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthManager, describeAuthError, parseAuthCallback } from '../src/main/account/auth'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const withCode = (code: string): Error => Object.assign(new Error('raw server text'), { code })

console.log('auth error wording:')
check(
  'an unconfirmed address points at the code',
  /never confirmed/i.test(describeAuthError(withCode('email_not_confirmed')))
)
check(
  'a wrong password says the two do not match',
  /do not match/i.test(describeAuthError(withCode('invalid_credentials')))
)
check(
  'an existing address points at sign-in',
  /already uses that address/i.test(describeAuthError(withCode('user_already_exists')))
)
check('an expired code asks for a new one', /expired/i.test(describeAuthError(withCode('otp_expired'))))
check(
  'the email rate limit is explained',
  /too many emails/i.test(describeAuthError(withCode('over_email_send_rate_limit')))
)
check(
  'an unknown error falls back to its message',
  describeAuthError(new Error('server exploded')) === 'server exploded'
)
check(
  'addresses are masked in fallback errors',
  /\[email\]/.test(describeAuthError(new Error('failed for someone@example.com')))
)

console.log('\ndesktop callbacks:')
check('the exact PKCE callback accepts a code', parseAuthCallback('viby://auth/callback?code=one-time')?.code === 'one-time')
check('the wrong path cannot sign in', parseAuthCallback('viby://auth/other?code=one-time') === null)
check('the wrong host cannot sign in', parseAuthCallback('viby://other/callback?code=one-time') === null)
check('raw session tokens are rejected', parseAuthCallback('viby://auth/callback?access_token=token&refresh_token=refresh') === null)
check('a token hash mixed with a code is rejected', parseAuthCallback('viby://auth/callback?code=one-time&token_hash=hash') === null)
check('fragment credentials are rejected', parseAuthCallback('viby://auth/callback#access_token=token') === null)

process.env.VIBY_TEST_USERDATA = mkdtempSync(join(tmpdir(), 'viby-auth-callback-'))
const manager = new AuthManager()
let exchanges = 0
Object.defineProperty(manager, 'clientInstance', { value: () => ({
  auth: {
    signInWithOtp: async () => ({ error: null }),
    exchangeCodeForSession: async () => {
      exchanges++
      return { data: { session: { user: { id: 'test-user', email: 'user@example.com' } } }, error: null }
    }
  }
}) })
await manager.handleCallback('viby://auth/callback?code=unsolicited')
check('unsolicited codes do not reach the Supabase exchange', exchanges === 0)
await manager.sendMagicLink('user@example.com')
await manager.handleCallback('viby://auth/callback?access_token=token&refresh_token=refresh')
check('a pending sign-in still rejects session tokens', exchanges === 0)
await manager.handleCallback('viby://auth/callback?code=locally-initiated')
check('a pending local flow can exchange a PKCE code', exchanges === 1 && manager.status().state === 'signed-in')
await manager.handleCallback('viby://auth/callback?code=second')
check('finishing the flow closes the callback to further exchanges', exchanges === 1)

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
