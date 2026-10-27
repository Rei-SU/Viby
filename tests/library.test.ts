/**
 * Library CRUD, persistence and self-healing. Run:
 *   npx esbuild tests/library.test.ts --bundle --platform=node --format=esm \
 *     --alias:@shared=./src/shared --alias:electron=./tests/electron-stub.ts \
 *     --outfile=/tmp/library.mjs && node /tmp/library.mjs
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Library } from '../src/main/library'
import type { Track } from '../src/shared/types'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const file = join(mkdtempSync(join(tmpdir(), 'viby-library-')), 'library.json')
const track = (id: string, title = id): Track => ({
  id,
  title,
  artist: 'Artist',
  durationSec: 200
})

const lib = new Library(file)

console.log('playlists:')
const created = lib.createPlaylist('  Road trip  ')
check('create trims the name', created.name === 'Road trip', created.name)
check('new playlist is empty', created.tracks.length === 0)

lib.addToPlaylist(created.id, track('a', 'A'))
lib.addToPlaylist(created.id, track('a', 'A duplicate'))
check('adding the same track twice keeps one', lib.playlist(created.id)?.tracks.length === 1)

lib.addToPlaylist(created.id, track('b', 'B'))
check('newest track first', lib.playlist(created.id)?.tracks[0].id === 'b')

const bulk = lib.createPlaylist('Bulk')
lib.addTracks(bulk.id, [track('c', 'C'), track('d', 'D'), track('c', 'C duplicate')])
check('bulk add keeps source order and dedupes', lib.playlist(bulk.id)?.tracks.map((t) => t.id).join(',') === 'c,d')
lib.deletePlaylist(bulk.id)

lib.removeFromPlaylist(created.id, 'b')
check('remove track', lib.playlist(created.id)?.tracks.map((t) => t.id).join(',') === 'a')

lib.renamePlaylist(created.id, 'Renamed')
check('rename', lib.playlist(created.id)?.name === 'Renamed')

// A second instance on the same file proves it is actually on disk.
const reloaded = new Library(file)
check('persists across instances', reloaded.playlists().length === 1)
check('persisted name', reloaded.playlists()[0]?.name === 'Renamed')
check('persisted tracks', reloaded.playlists()[0]?.tracks.length === 1)

console.log('\nsaved releases:')
const savedAlbum = {
  id: 'MPREb_one',
  title: 'One',
  artist: 'Artist',
  releaseType: 'Album',
  trackCount: 10,
  savedAt: 0
}
check('save adds a release', lib.toggleAlbum(savedAlbum).saved === true && lib.albums().length === 1)
check('the save is timestamped', (lib.albums()[0]?.savedAt ?? 0) > 0)
check('the release label is kept', lib.albums()[0]?.releaseType === 'Album')
check(
  'saving again removes it',
  lib.toggleAlbum(savedAlbum).saved === false && lib.albums().length === 0
)
lib.toggleAlbum(savedAlbum)
lib.toggleAlbum({ ...savedAlbum, id: 'MPREb_ep', title: 'EP', releaseType: 'EP' })
check('newest saved first', lib.albums()[0]?.id === 'MPREb_ep')
check('saved releases persist', new Library(file).albums().length === 2)

console.log('\nfavourites:')
lib.toggleFavorite(track('x', 'X'))
check('favourite is stored', lib.isFavorite('x'))
check('favourite toggles off', lib.toggleFavorite(track('x')).favorited === false)

console.log('\nself-healing:')
const raw = JSON.parse(readFileSync(file, 'utf8'))
raw.playlists = [
  null,
  { id: 'broken', name: 'Broken', createdAt: 0, updatedAt: 0, tracks: [null, { nope: true }] },
  { id: 'ok', name: 'Ok', createdAt: 0, updatedAt: 0, tracks: [null, track('y', 'Y')] }
]
raw.favorites = [null, track('z', 'Z')]
raw.albums = [null, { id: '', title: 'No id' }, { id: 'ok-album', title: 'Ok', savedAt: 1 }]
writeFileSync(file, JSON.stringify(raw))

const healed = new Library(file)
check('drops null playlists', healed.playlists().length === 2, `${healed.playlists().length}`)
check(
  'drops malformed playlist tracks',
  healed.playlists().find((p) => p.id === 'ok')?.tracks.length === 1
)
check('drops malformed favourites', healed.favorites().length === 1)
check(
  'drops malformed saved releases',
  healed.albums().length === 1 && healed.albums()[0]?.id === 'ok-album',
  JSON.stringify(healed.albums())
)

console.log('\ndelete:')
healed.deletePlaylist('ok')
check('delete removes the playlist', new Library(file).playlists().length === 1)

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
