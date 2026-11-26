/**
 * Empty-install attach: a fresh device signing into an existing account must
 * take the server's library and settings, never push this device's defaults
 * over them. Run: node tests/unit.mjs account-bootstrap
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OutboxRecord } from '../src/main/account/outbox'
import { applyRemoteRecordsTracked, RecordTracker } from '../src/main/account/records'
import { lib } from '../src/main/library'
import { settings, setSettings } from '../src/main/settings'

process.env.VIBY_TEST_USERDATA = mkdtempSync(join(tmpdir(), 'viby-bootstrap-'))

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const book = lib()
check(
  'the test library starts empty',
  book.favorites().length === 0 &&
    book.playlists().length === 0 &&
    book.albums().length === 0 &&
    book.history(5).length === 0
)

const tracker = new RecordTracker()
const seeded = tracker.begin('user-empty')
check('an empty install seeds no records', seeded.length === 0, String(seeded.length))
check('default settings are not queued as changes', tracker.diff().length === 0)

const remotes: OutboxRecord[] = [
  { kind: 'setting', recordId: 'audioQuality', payload: { value: 'data-saver' }, updatedAt: 1000, deviceId: 'server', deleted: false },
  { kind: 'setting', recordId: 'shuffle', payload: { value: true }, updatedAt: 1000, deviceId: 'server', deleted: false },
  { kind: 'setting', recordId: 'repeat', payload: { value: 'all' }, updatedAt: 1000, deviceId: 'server', deleted: false },
  { kind: 'setting', recordId: 'autoplay', payload: { value: false }, updatedAt: 1000, deviceId: 'server', deleted: false },
  { kind: 'setting', recordId: 'discordPresence', payload: { value: false }, updatedAt: 1000, deviceId: 'server', deleted: false }
]
const applied = applyRemoteRecordsTracked(remotes)
check('the server setting is applied', settings().get().audioQuality === 'data-saver')
check('the pull accepted every setting', applied.accepted.length === 5, String(applied.accepted.length))

tracker.acceptAll(applied.accepted)
tracker.bootstrapComplete()
check('nothing echoes back after the first pull', tracker.diff().length === 0)

setSettings({ audioQuality: 'best' })
check('a setting changed after bootstrap is detected', tracker.diff().length === 1)
tracker.begin('user-empty')

book.toggleFavorite({ id: 'bootstrap-fav', title: 'Bootstrap', artist: 'Artist', durationSec: 120 })
const changes = tracker.diff()
check(
  'new local content on an empty install still syncs',
  changes.length === 1 && changes[0]?.recordId === 'bootstrap-fav'
)

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
