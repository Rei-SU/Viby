/**
 * Per-account local roots: the first account copies the legacy library once, a
 * second account starts empty, and signing out returns to the local library.
 * Run: node tests/unit.mjs library-root
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setActiveLibrary, lib } from '../src/main/library'
import { libraryPathFor } from '../src/main/account/library-root'

process.env.VIBY_TEST_USERDATA = mkdtempSync(join(tmpdir(), 'viby-roots-'))

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const root = libraryPathFor(null)
mkdirSync(dirname(root), { recursive: true })
writeFileSync(
  root,
  JSON.stringify({
    favorites: [{ id: 'local-fav', title: 'Local', artist: 'Artist', durationSec: 120 }],
    history: [],
    playlists: [],
    albums: []
  })
)
check('the local library file exists', existsSync(root))

check('the first account switches', setActiveLibrary('user-a'))
check('it adopts the legacy favourites', lib().favorites().length === 1)
check('its root is separate', existsSync(libraryPathFor('user-a')))
check('the local root is untouched', existsSync(root))

check('a second account switches', setActiveLibrary('user-b'))
check('it starts empty', lib().favorites().length === 0)
check('it does not copy the first account', !existsSync(libraryPathFor('user-b')))

check('signing out switches back', setActiveLibrary(null))
check('the local library is still there', lib().favorites().length === 1)

check('signing in again reuses the account root', setActiveLibrary('user-a'))
check('the first account keeps its library', lib().favorites().length === 1)

check('same account twice is a no-op', setActiveLibrary('user-a') === false)

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
