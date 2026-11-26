/**
 * OTP input normalisation: the project's code length is an Auth setting
 * (6–10 digits), so the app must not assume six. Run:
 * node tests/unit.mjs account-otp
 */
import { normalizeOtpCode, OTP_MIN_LENGTH } from '../src/shared/account'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('otp normalisation:')
check('six digits are kept', normalizeOtpCode('123456') === '123456')
check('eight digits are kept whole', normalizeOtpCode('12345678') === '12345678')
check('ten digits are kept', normalizeOtpCode('1234567890') === '1234567890')
check('spaces and dashes are stripped', normalizeOtpCode('123 456-78') === '12345678')
check('letters are stripped', normalizeOtpCode('1a2b3c4d5e6f') === '123456')
check('leading zeros survive', normalizeOtpCode('00123456') === '00123456')
check('more than ten digits are capped', normalizeOtpCode('1234567890123') === '1234567890')
check('empty stays empty', normalizeOtpCode('') === '')
check('the minimum is six', OTP_MIN_LENGTH === 6)
check('an eight-digit code counts as complete', normalizeOtpCode('12345678').length >= OTP_MIN_LENGTH)
check('five digits are incomplete', normalizeOtpCode('12345').length < OTP_MIN_LENGTH)

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
