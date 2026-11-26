/**
 * Account error wording: server codes map to a sentence the user can act on.
 * Run: node tests/unit.mjs account-auth-errors
 */
import { describeAuthError } from '../src/main/account/auth'

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

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
