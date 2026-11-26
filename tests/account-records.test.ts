/**
 * Record mapping between the local JSON stores and sync records, the settings
 * whitelist, tombstone bookkeeping and the first-sync backfill. Run:
 * node tests/unit.mjs account-records
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HistoryEntry, Playlist, SavedAlbum, Track } from '../src/shared/types'
import {
  HISTORY_LIMIT,
  SYNCED_SETTINGS,
  TOMBSTONE_MS,
  RecordTracker,
  applyRemoteRecords,
  historyRecordId,
  parseHistoryRecordId,
  readLocalRecords
} from '../src/main/account/records'
import { lib } from '../src/main/library'
import { setSettings, settings } from '../src/main/settings'
import { recordKey } from '../src/main/account/compare'
import type { OutboxRecord } from '../src/main/account/outbox'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

process.env.VIBY_TEST_USERDATA = mkdtempSync(join(tmpdir(), 'viby-records-'))
const book = lib()

const track = (id: string, title = id): Track => ({ id, title, artist: 'Artist', durationSec: 120 })
const history = (trackId: string, playedAt: number, title = trackId): HistoryEntry => ({
  trackId,
  title,
  artist: 'Artist',
  playedAt,
  completion: 0.5
})
const rec = (
  kind: OutboxRecord['kind'],
  recordId: string,
  payload: unknown,
  updatedAt = 0,
  deviceId = 'device-a',
  deleted = false
): OutboxRecord => ({ kind, recordId, payload, updatedAt, deviceId, deleted })

console.log('history ids:')
{
  check('the id joins track and time', historyRecordId({ trackId: 'abc', playedAt: 123 }) === 'abc:123')
  check('the id round-trips', parseHistoryRecordId('abc:123')?.trackId === 'abc' && parseHistoryRecordId('abc:123')?.playedAt === 123)
  check('a colon inside the track id is kept', parseHistoryRecordId('a:b:42')?.trackId === 'a:b')
  check('the split uses the last colon', parseHistoryRecordId('a:b:42')?.playedAt === 42)
  check('no colon is rejected', parseHistoryRecordId('abc') === null)
  check('an empty track side is rejected', parseHistoryRecordId(':123') === null)
  check('a non-numeric time is rejected', parseHistoryRecordId('abc:nope') === null)
  check('an empty id is rejected', parseHistoryRecordId('') === null)
}

console.log('\nthe settings whitelist:')
{
  check(
    'exactly five settings travel',
    SYNCED_SETTINGS.join(',') === 'audioQuality,shuffle,repeat,autoplay,discordPresence',
    SYNCED_SETTINGS.join(',')
  )
  check('volume is not synced', !(SYNCED_SETTINGS as readonly string[]).includes('volume'))
  check('cache size is not synced', !(SYNCED_SETTINGS as readonly string[]).includes('cacheCapBytes'))
}

console.log('\nlocal to record mapping:')
{
  const favorite = track('map-fav', 'Favourite')
  book.toggleFavorite(favorite)
  const playlist = book.createPlaylist('Map list')
  book.addToPlaylist(playlist.id, favorite)
  const saved = { id: 'map-alb', title: 'Album', savedAt: 2222 } as SavedAlbum
  book.toggleAlbum(saved)
  book.addHistory(history('map-hist', 1111, 'Played'))
  setSettings({ audioQuality: 'data-saver', shuffle: true })

  const map = readLocalRecords()
  const fav = map.get(recordKey('favorite', 'map-fav'))
  check('a favourite becomes a record', fav?.kind === 'favorite' && (fav?.payload as Track).id === 'map-fav')
  check('favourites carry no natural timestamp', fav?.updatedAt === 0)
  check('favourite records are live', fav?.deleted === false)

  const storedPlaylist = book.playlist(playlist.id)!
  const pl = map.get(recordKey('playlist', playlist.id))
  check('a playlist keeps its updatedAt', pl?.updatedAt === storedPlaylist.updatedAt)
  check(
    'playlist metadata carries no tracks',
    !Object.prototype.hasOwnProperty.call(pl?.payload ?? {}, 'tracks')
  )
  const entry = map.get(recordKey('playlist_track', `${playlist.id}:map-fav`))
  check('each playlist entry is its own record', entry?.kind === 'playlist_track')
  check(
    'the entry carries its position',
    (entry?.payload as { position?: number } | undefined)?.position === 0
  )

  const storedAlbum = book.albums().find((album) => album.id === 'map-alb')!
  const album = map.get(recordKey('album', 'map-alb'))
  check('a saved album maps to the album kind', album?.kind === 'album')
  check('an album uses savedAt as its timestamp', album?.updatedAt === storedAlbum.savedAt)

  const hist = map.get(recordKey('history', 'map-hist:1111'))
  check('history maps to its play id', hist?.kind === 'history')
  check('history uses playedAt as its timestamp', hist?.updatedAt === 1111)

  const quality = map.get(recordKey('setting', 'audioQuality'))
  check('a whitelisted setting travels', JSON.stringify(quality?.payload) === JSON.stringify({ value: 'data-saver' }))
  check('a boolean setting travels', JSON.stringify(map.get(recordKey('setting', 'shuffle'))?.payload) === '{"value":true}')
  check('an untouched setting still travels', JSON.stringify(map.get(recordKey('setting', 'repeat'))?.payload) === '{"value":"off"}')
  check('the default volume is not a record', ![...map.keys()].some((key) => key.endsWith('\u0000volume')))
  check('one record per favourite', [...map.keys()].filter((key) => key.startsWith('favorite\u0000')).length === 1)
}

console.log('\ntracker begin and backfill:')
{
  const tracker = new RecordTracker()
  const seeded = tracker.begin('user-a')
  check('the account is bound', tracker.account === 'user-a')
  check('the first sign-in seeds every local record', seeded.length === readLocalRecords().size, `${seeded.length}`)
  check('the seed includes favourites', seeded.some((record) => record.kind === 'favorite' && record.recordId === 'map-fav'))
  check('the seed includes settings', seeded.some((record) => record.kind === 'setting' && record.recordId === 'audioQuality'))
  check('a repeat begin seeds nothing', tracker.begin('user-a').length === 0)
  check('a second account adopts no records', tracker.begin('user-b').length === 0)
  check('the second account has nothing to push', tracker.diff().length === 0)
  check('diff is quiet straight after begin', tracker.diff().length === 0)
}

console.log('\ndiff: edits, tombstones and pruning:')
{
  const tracker = new RecordTracker()
  tracker.begin('diff-user')
  check('no changes means no work', tracker.diff().length === 0)

  book.toggleFavorite(track('diff-add', 'Added'))
  const now = 1_700_000_000_000
  const added = tracker.diff(now)
  check('an added favourite is detected', added.length === 1 && added[0]?.recordId === 'diff-add')
  check('the edit is stamped now', added[0]?.updatedAt === now)
  check('the edit is live', added[0]?.deleted === false)
  check('the same edit is not reported twice', tracker.diff(now + 1).length === 0)

  // A non-whitelisted setting change must never become a record.
  const volumeBefore = settings().get().volume
  setSettings({ volume: 0.25 })
  check('changing volume produces no record', tracker.diff(now + 2).length === 0)
  check('volume still changed locally', settings().get().volume !== volumeBefore)

  book.toggleFavorite(track('diff-add', 'Added'))
  const at = 1_700_000_100_000
  const removed = tracker.diff(at)
  check('a removal becomes a tombstone', removed.length === 1 && removed[0]?.deleted === true)
  check('the tombstone keeps the key', removed[0]?.kind === 'favorite' && removed[0]?.recordId === 'diff-add')
  check('the tombstone has no payload', removed[0]?.payload === null)
  check('the tombstone is in the local map', tracker.localMap().get(recordKey('favorite', 'diff-add'))?.deleted === true)
  check('a tombstone is not reported twice', tracker.diff(at + 1).length === 0)

  check('a tombstone younger than 90 days is kept', tracker.localMap().has(recordKey('favorite', 'diff-add')))
  tracker.diff(at + TOMBSTONE_MS)
  check('a tombstone exactly 90 days old is kept', tracker.localMap().has(recordKey('favorite', 'diff-add')))
  tracker.diff(at + TOMBSTONE_MS + 1)
  check('an expired tombstone is pruned', !tracker.localMap().has(recordKey('favorite', 'diff-add')))
  check('pruning does not resurrect the record', readLocalRecords().has(recordKey('favorite', 'diff-add')) === false)
}

console.log('\npulled records are not echoed:')
{
  const tracker = new RecordTracker()
  tracker.begin('echo-user')

  const remotePlaylist: Playlist = {
    id: 'echo-pl',
    name: 'From another device',
    createdAt: 1000,
    updatedAt: 2000,
    tracks: []
  }
  const remoteItem = rec(
    'playlist_track',
    'echo-pl:echo-track',
    { playlistId: 'echo-pl', track: track('echo-track', 'Remote'), position: 0 },
    2000,
    'device-z'
  )
  const pulled = [rec('playlist', 'echo-pl', remotePlaylist, 2000, 'device-z'), remoteItem]
  check('the pulled playlist is applied', applyRemoteRecords(pulled) === 2)
  check('it is in the local store', book.playlist('echo-pl')?.name === 'From another device')
  check(
    'its entry is in the local store',
    book.playlist('echo-pl')?.tracks.some((entry) => entry.id === 'echo-track') === true
  )
  tracker.acceptAll(pulled)
  check('an accepted pull is not pushed back', tracker.diff().length === 0)
  check('the tracker remembers the remote version', tracker.localMap().get(recordKey('playlist', 'echo-pl'))?.updatedAt === 2000)
  check('the local map still sees the record as live', tracker.localMap().get(recordKey('playlist', 'echo-pl'))?.deleted === false)
}

console.log('\napplying pulled records:')
{
  const before = book.favorites().length
  const favRecord = rec('favorite', 'rr-fav', track('rr-fav', 'Remote favourite'))
  const invalidFav = rec('favorite', 'rr-bad', { id: '', title: 'No id' })
  check('a live favourite applies', applyRemoteRecords([favRecord]) === 1)
  check('the favourite is in the library', book.isFavorite('rr-fav') && book.favorites().length === before + 1)
  applyRemoteRecords([invalidFav])
  check('an invalid favourite is skipped', !book.isFavorite('rr-bad'))

  book.toggleFavorite(track('rr-drop', 'Drop me'))
  applyRemoteRecords([rec('favorite', 'rr-drop', null, 9, 'd', true)])
  check('a favourite tombstone deletes it', !book.isFavorite('rr-drop'))

  const playlist: Playlist = {
    id: 'rr-pl',
    name: 'Remote list',
    createdAt: 1,
    updatedAt: 2,
    tracks: []
  }
  const items = [
    rec('playlist', 'rr-pl', playlist, 2),
    rec(
      'playlist_track',
      'rr-pl:rr-t1',
      { playlistId: 'rr-pl', track: track('rr-t1', 'One'), position: 0 },
      2
    ),
    rec(
      'playlist_track',
      'rr-pl:rr-t2',
      { playlistId: 'rr-pl', track: track('rr-t2', 'Two'), position: 1 },
      2
    ),
    rec(
      'playlist_track',
      'rr-pl:rr-bad',
      { playlistId: 'rr-pl', track: { id: 'broken' }, position: 2 },
      2
    )
  ]
  check('a playlist applies', applyRemoteRecords(items) === 3)
  check('invalid tracks are dropped from it', book.playlist('rr-pl')?.tracks.length === 2, String(book.playlist('rr-pl')?.tracks.length))
  check(
    'entries keep their order',
    book.playlist('rr-pl')?.tracks.map((entry) => entry.id).join(',') === 'rr-t1,rr-t2'
  )
  applyRemoteRecords([rec('playlist', 'rr-pl', null, 3, 'd', true)])
  check('a playlist tombstone deletes it', book.playlist('rr-pl') === null)

  const album: SavedAlbum = { id: 'rr-alb', title: 'Remote album', savedAt: 1234 }
  applyRemoteRecords([rec('album', 'rr-alb', album, 1234)])
  check('an album applies', book.isAlbumSaved('rr-alb'))
  applyRemoteRecords([rec('album', 'rr-alb', null, 1235, 'd', true)])
  check('an album tombstone deletes it', !book.isAlbumSaved('rr-alb'))

  check('a malformed record is skipped', applyRemoteRecords([rec('album', 'rr-bad-alb', { id: 'rr-bad-alb', title: '', savedAt: 1 })]) === 0)
}

console.log('\nhistory union:')
{
  book.addHistory(history('union-local', 500, 'Local'))
  const remote = [
    rec('history', 'union-a:1000', history('union-a', 1000, 'A'), 1000),
    rec('history', 'union-b:3000', history('union-b', 3000, 'B'), 3000),
    rec('history', 'union-c:2000', history('union-c', 2000, 'C'), 2000)
  ]
  const applied = applyRemoteRecords(remote)
  check('all three remote plays apply', applied === 3, String(applied))

  const times = book.history(100).map((entry) => entry.playedAt)
  check('local and remote plays are unioned', new Set(times).size === times.length)
  check('the union is newest first', times.every((value, i) => i === 0 || times[i - 1]! >= value))
  check('the local play survives', book.history(100).some((entry) => entry.trackId === 'union-local'))

  applyRemoteRecords([rec('history', 'union-a:1000', history('union-a', 1000, 'A renamed'), 1000)])
  const duplicates = book.history(100).filter((entry) => entry.trackId === 'union-a')
  check('re-applying one play does not duplicate it', duplicates.length === 1, String(duplicates.length))
  check('the newer payload replaces the row', duplicates[0]?.title === 'A renamed')

  applyRemoteRecords([rec('history', 'union-b:3000', null, 4000, 'd', true)])
  check('a history tombstone deletes exactly that play', !book.history(100).some((entry) => entry.trackId === 'union-b' && entry.playedAt === 3000))
  check('other plays with the same track id stay', book.history(100).filter((entry) => entry.trackId === 'union-a').length === 1)

  check('an unparseable history id is skipped', applyRemoteRecords([rec('history', 'no-colon', history('x', 1), 1)]) === 0)
}

console.log('\nsettings from a pull:')
{
  setSettings({ audioQuality: 'data-saver', volume: 0.4 })
  applyRemoteRecords([rec('setting', 'audioQuality', { value: 'best' }, 1)])
  check('a whitelisted setting applies', settings().get().audioQuality === 'best')

  applyRemoteRecords([rec('setting', 'volume', { value: 0.9 }, 1)])
  check('a non-whitelisted setting is ignored', settings().get().volume === 0.4)

  applyRemoteRecords([rec('setting', 'audioQuality', { value: 'data-saver' }, 2, 'd', true)])
  check('a setting tombstone is ignored', settings().get().audioQuality === 'best')
  check('a setting without a value is skipped', applyRemoteRecords([rec('setting', 'shuffle', {})]) === 0)
  check('a setting payload that is not an object is skipped', applyRemoteRecords([rec('setting', 'shuffle', true)]) === 0)
}

console.log('\nhistory cap:')
{
  const many: OutboxRecord[] = []
  for (let i = 1; i <= HISTORY_LIMIT + 1; i++) {
    many.push(rec('history', `cap-${i}:${i}`, history(`cap-${i}`, i), i))
  }
  applyRemoteRecords(many)
  const kept = book.history(HISTORY_LIMIT + 10)
  check('history is capped at 5,000', kept.length === HISTORY_LIMIT, String(kept.length))
  check('the newest play is kept', kept[0]?.playedAt === HISTORY_LIMIT + 1)
  check('the oldest play is dropped', !kept.some((entry) => entry.trackId === 'cap-1'))
  check('record mapping also reads only the cap', readLocalRecords().size < HISTORY_LIMIT + 100)
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
