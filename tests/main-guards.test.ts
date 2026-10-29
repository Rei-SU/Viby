/**
 * Shared main-process guards: private-address blocking and image extensions.
 * Run: node tests/unit.mjs main-guards
 */
import { extensionFor } from '../src/main/image-extension'
import { isPrivateAddress } from '../src/main/private-address'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('private IPv4 ranges:')
check('loopback', isPrivateAddress('127.0.0.1'))
check('private class A', isPrivateAddress('10.1.2.3'))
check('private class B', isPrivateAddress('172.16.5.5'))
check('class B stops at 172.32', !isPrivateAddress('172.32.0.1'))
check('private class C', isPrivateAddress('192.168.1.1'))
check('carrier-grade NAT', isPrivateAddress('100.64.0.1'))
check('link-local', isPrivateAddress('169.254.1.1'))
check('unspecified', isPrivateAddress('0.0.0.0'))
check('public address allowed', !isPrivateAddress('8.8.8.8'))
check('public address allowed (2)', !isPrivateAddress('1.1.1.1'))

console.log('\nIPv6 ranges:')
check('loopback', isPrivateAddress('::1'))
check('unspecified', isPrivateAddress('::'))
check('unique local fc', isPrivateAddress('fc00::1'))
check('unique local fd', isPrivateAddress('fd12:3456::1'))
check('link-local', isPrivateAddress('fe80::1'))
check('mapped loopback', isPrivateAddress('::ffff:127.0.0.1'))
check('mapped private', isPrivateAddress('::ffff:10.0.0.5'))
check('public IPv6 allowed', !isPrivateAddress('2001:4860:4860::8888'))

console.log('\nnon-IP input is not trusted:')
check('host name treated as private', isPrivateAddress('localhost'))
check('garbage treated as private', isPrivateAddress('not-an-ip'))

console.log('\nimage extensions:')
check('png type', extensionFor('image/png', 'https://example.test/a') === 'png')
check('jpeg with charset', extensionFor('image/jpeg; charset=utf-8', '') === 'jpg')
check('webp type', extensionFor('image/webp', '') === 'webp')
check('gif type', extensionFor('image/gif', '') === 'gif')
check('type wins over URL', extensionFor('image/png', 'https://example.test/a.jpg') === 'png')
check('URL fallback', extensionFor('application/octet-stream', 'https://example.test/a.webp?x=1') === 'webp')
check('jpeg URL maps to jpg', extensionFor('', 'https://example.test/a.jpeg') === 'jpg')
check('unknown defaults to jpg', extensionFor('', 'https://example.test/a') === 'jpg')

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
