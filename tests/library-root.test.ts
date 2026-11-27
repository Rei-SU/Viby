/**
 * Per-account local roots: the first account copies the legacy library once, a
 * second account starts empty, and signing out returns to the local library.
 * Run: node tests/unit.mjs library-root
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setActiveLibrary, lib } from '../src/main/library'
import { accountFile, legacyOutboxFile, libraryPathFor, removeAccountData } from '../src/main/account/library-root'
import { Outbox } from '../src/main/account/outbox'
import { accountSettingsNeedPull, finishAccountSettingsPull, setActiveSettings, settings, setSettings } from '../src/main/settings'

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

setSettings({ shuffle: true, volume: 0.3 })
setActiveSettings('user-a')
check('account settings start separate from the device preferences', !settings().get().shuffle && accountSettingsNeedPull())
setSettings({ repeat: 'all', volume: 0.5 })
finishAccountSettingsPull()
setActiveSettings('user-b')
check('a second account does not inherit playback preferences', settings().get().repeat === 'off')
check('device volume still travels with the install', settings().get().volume === 0.5)
setActiveSettings('user-a')
check('an account gets its own saved settings back', settings().get().repeat === 'all' && !accountSettingsNeedPull())
setActiveSettings(null)
check('sign out restores signed-out preferences', settings().get().shuffle && settings().get().repeat === 'off')

const legacy = legacyOutboxFile('user-b')
writeFileSync(legacy, JSON.stringify({ records: [{
  kind: 'favorite', recordId: 'pending', payload: {}, updatedAt: 1, deviceId: 'local', deleted: false
}] }))
const outbox = new Outbox()
outbox.useUser('user-b')
const scoped = accountFile('user-b', 'outbox.json')
check('legacy pending edits move inside the account directory', outbox.count() === 1 && existsSync(scoped) && !existsSync(legacy))
writeFileSync(legacy, '{}')
writeFileSync(`${legacy}.corrupt-42`, 'old data')
writeFileSync(legacyOutboxFile('user-a'), '{}')
outbox.useUser(null)
removeAccountData('user-b')
check('account deletion cleans up both outbox locations', !existsSync(scoped) && !existsSync(legacy))
check('account deletion removes its quarantined legacy queue only',
  !existsSync(`${legacy}.corrupt-42`) && existsSync(legacyOutboxFile('user-a')))

const damaged = accountFile('user-c', 'library.json')
writeFileSync(damaged, '{"favorites":null}')
setActiveLibrary('user-c')
check('a malformed collection is marked for recovery before its shape is repaired', lib().loadFailed)
setActiveLibrary(null)
setActiveLibrary('user-c')
check('repaired JSON still needs a cloud pull after restart', lib().loadFailed)

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
