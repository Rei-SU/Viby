/**
 * The refresh-token vault: encrypted with safeStorage when a keyring exists,
 * memory-only otherwise, and never plaintext on disk. safeStorage is the test
 * stub so both states can be simulated. Run: node tests/unit.mjs account-tokens
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeStorage } from './electron-stub'
import { TokenVault } from '../src/main/account/tokens'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const dir = mkdtempSync(join(tmpdir(), 'viby-tokens-'))
process.env.VIBY_TEST_USERDATA = dir
const vaultPath = join(dir, 'account-tokens.bin')

const reset = (): void => {
  safeStorage.available = true
  safeStorage.encryptString = (value: string): Buffer =>
    Buffer.from(`viby-test-enc:${Buffer.from(value, 'utf8').toString('base64')}`, 'utf8')
  safeStorage.decryptString = (value: Buffer): string => {
    const raw = value.toString('utf8')
    const prefix = 'viby-test-enc:'
    if (!raw.startsWith(prefix)) throw new Error('not encrypted by this stub')
    return Buffer.from(raw.slice(prefix.length), 'base64').toString('utf8')
  }
}

console.log('encrypted at rest:')
{
  reset()
  const vault = new TokenVault()
  check('the vault lives in userData', vault.path === vaultPath, vault.path)
  check('a fresh vault has no session', vault.hasSession === false)
  check('it reports persistence', vault.persistent === true)

  vault.setItem('viby-account', 'refresh-token-one')
  vault.setItem('other', 'second-value')
  check('items read back', vault.getItem('viby-account') === 'refresh-token-one')
  check('a missing key is null', vault.getItem('missing') === null)
  check('hasSession sees a stored token', vault.hasSession === true)

  const onDisk = readFileSync(vaultPath)
  check('the file exists', existsSync(vaultPath))
  check('the token is not plaintext on disk', !onDisk.toString('utf8').includes('refresh-token-one'))
  check('the file looks like safeStorage output', onDisk.toString('utf8').startsWith('viby-test-enc:'))

  const restarted = new TokenVault()
  check('a restart restores the token', restarted.getItem('viby-account') === 'refresh-token-one')
  check('a restart restores every key', restarted.getItem('other') === 'second-value')

  restarted.removeItem('other')
  check('remove drops one key', restarted.getItem('other') === null)
  check('remove keeps the others', restarted.getItem('viby-account') === 'refresh-token-one')
  check('the removal is on disk', new TokenVault().getItem('other') === null)

  restarted.clear()
  check('clear empties memory', restarted.getItem('viby-account') === null)
  check('clear removes the file', !existsSync(vaultPath))
  check('a cleared vault has no session', restarted.hasSession === false)
}

console.log('\nmemory-only fallback:')
{
  reset()
  safeStorage.available = false
  const vault = new TokenVault()
  vault.setItem('viby-account', 'ephemeral-token')
  check('the session is still usable in this run', vault.getItem('viby-account') === 'ephemeral-token')
  check('it reports no persistence', vault.persistent === false)
  check('nothing is written to disk', !existsSync(vaultPath))

  const again = new TokenVault()
  check('a restart starts signed out', again.getItem('viby-account') === null)
}

console.log('\na write failure stays in memory:')
{
  reset()
  const vault = new TokenVault()
  safeStorage.encryptString = (): Buffer => {
    throw new Error('keyring locked')
  }
  vault.setItem('viby-account', 'still-valid-this-run')
  check('the token survives in memory', vault.getItem('viby-account') === 'still-valid-this-run')
  check('persistence is reported false', vault.persistent === false)
  check('no partial file is left behind', !existsSync(vaultPath))
  reset()
}

console.log('\nunreadable files:')
{
  reset()
  writeFileSync(vaultPath, 'garbage that is not encrypted')
  const vault = new TokenVault()
  check('a corrupt file does not throw', vault.getItem('viby-account') === null)
  check('the corrupt file is left for diagnosis', existsSync(vaultPath))
  vault.setItem('viby-account', 'after-corruption')
  check('a later write replaces it', new TokenVault().getItem('viby-account') === 'after-corruption')
}

console.log('\na vault written with a keyring, read without one:')
{
  reset()
  const writer = new TokenVault()
  writer.setItem('viby-account', 'written-with-keyring')
  const bytes = readFileSync(vaultPath)

  safeStorage.available = false
  const reader = new TokenVault()
  check('the token cannot be read without a keyring', reader.getItem('viby-account') === null)
  check('the encrypted file is kept', existsSync(vaultPath) && readFileSync(vaultPath).equals(bytes))
  check('it does not claim persistence', reader.persistent === false)
  reset()
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
