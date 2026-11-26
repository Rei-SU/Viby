/**
 * Sync record identity and last-writer-wins ordering. This is the same rule the
 * `sync_push` RPC applies server-side, so these cases double as the contract the
 * migration must keep. Run: node tests/unit.mjs account-compare
 */
import {
  SYNC_KINDS,
  compareVersions,
  isSyncKind,
  keyParts,
  recordKey,
  remoteWins,
  type Versioned
} from '../src/main/account/compare'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const v = (updatedAt: number, deviceId = 'device-a', deleted = false): Versioned => ({
  updatedAt,
  deviceId,
  deleted
})

console.log('kinds and keys:')
{
  check(
    'the six kinds are fixed',
    SYNC_KINDS.join(',') === 'favorite,playlist,playlist_track,album,history,setting'
  )

  for (const kind of SYNC_KINDS) check(`${kind} is a sync kind`, isSyncKind(kind))
  check('an unknown kind is rejected', !isSyncKind('download'))
  check('a non-string is rejected', !isSyncKind(42 as unknown))

  const key = recordKey('favorite', 'abc')
  check('the key carries both parts', keyParts(key)?.kind === 'favorite' && keyParts(key)?.recordId === 'abc')
  check('the separator cannot appear in an id', key.split('\u0000').length === 2 && key.startsWith('favorite\u0000'))

  // A record id may itself contain a colon (history uses it), and that must not
  // confuse the kind/record split.
  check('a colon in the id survives', keyParts(recordKey('history', 'abc:123'))?.recordId === 'abc:123')

  check('a key without a separator is rejected', keyParts('favoriteabc') === null)
  check('an unknown kind in a key is rejected', keyParts('download\u0000abc') === null)
  check('an empty record id is rejected', keyParts('favorite\u0000') === null)
}

console.log('\nlast-writer-wins:')
{
  check('a newer timestamp wins', compareVersions(v(2000), v(1000)) > 0)
  check('an older timestamp loses', compareVersions(v(1000), v(2000)) < 0)
  check('the remote check uses the same order', remoteWins(v(1000), v(2000)) === true)
  check('an older remote copy does not overwrite', remoteWins(v(2000), v(1000)) === false)

  check('equal timestamps break by device id', compareVersions(v(1000, 'b'), v(1000, 'a')) > 0)
  check('a lower device id loses the tie', compareVersions(v(1000, 'a'), v(1000, 'b')) < 0)
  check('the device tie is a plain string order', compareVersions(v(1000, '10'), v(1000, '9')) < 0)

  check('an exact tie keeps the holder', compareVersions(v(1000), v(1000)) === 0)
  check('an exact tie is not overwritten', remoteWins(v(1000), v(1000)) === false)

  check('a tombstone wins a timestamp tie', compareVersions(v(1000, 'a', true), v(1000, 'a', false)) > 0)
  check('a live record loses an exact tombstone tie', remoteWins(v(1000, 'a', false), v(1000, 'a', true)) === true)
  check('two tombstones tie', compareVersions(v(1000, 'a', true), v(1000, 'a', true)) === 0)

  check('a newer live record beats an older tombstone', compareVersions(v(2000, 'a', false), v(1000, 'a', true)) > 0)

  check('no local copy always accepts the remote one', remoteWins(null, v(0)) === true)
  check('an undefined local copy accepts the remote one', remoteWins(undefined, v(0)) === true)
  check('a zero timestamp can still win', remoteWins(v(0), v(0, 'zzz')) === true)

  check('the comparison is antisymmetric', compareVersions(v(5, 'x'), v(4, 'y')) === -compareVersions(v(4, 'y'), v(5, 'x')))
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
