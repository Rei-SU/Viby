/**
 * Library tile model: saved playlists and downloaded albums share one grid,
 * downloaded playlists are not duplicated, and badges use real local coverage.
 * Run: node tests/unit.mjs library-items
 */
import type { DownloadCollection, DownloadEntry, Playlist, Track } from '../src/shared/types'
import { buildLibraryItems, markFor } from '../src/renderer/lib/library-items'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

function track(id: string, thumbnail?: string): Track {
  return {
    id,
    title: `Song ${id}`,
    artist: 'Artist',
    durationSec: 120,
    thumbnail
  }
}

function entry(id: string, sources: string[], artUrl?: string): DownloadEntry {
  return {
    track: track(id),
    ext: 'm4a',
    bytes: 1024,
    downloadedAt: 1,
    quality: 'best',
    artUrl,
    sources
  }
}

function collection(
  key: string,
  kind: DownloadCollection['kind'],
  title: string,
  trackIds: string[]
): DownloadCollection {
  return { key, kind, title, trackIds, addedAt: 1 }
}

console.log('marks:')
check('none with no downloads', markFor(0, 10) === 'none')
check('partial', markFor(3, 10) === 'partial')
check('full', markFor(10, 10) === 'full')
check('empty collection is none', markFor(0, 0) === 'none')

const favorites = [track('f1', 'https://img/f1.jpg'), track('f2')]
const playlistA: Playlist = {
  id: 'p1',
  name: 'Road trip',
  createdAt: 1,
  updatedAt: 3,
  tracks: [track('a', 'https://img/a.jpg'), track('b'), track('c')]
}
const playlistB: Playlist = {
  id: 'p2',
  name: 'Quiet',
  createdAt: 1,
  updatedAt: 2,
  tracks: [track('x'), track('y')]
}
const collections = [
  collection('liked', 'liked', 'Liked songs', ['f1', 'f2']),
  collection('playlist:p1', 'playlist', 'Road trip', ['a', 'b', 'c']),
  collection('album:z1', 'album', 'Album Z', ['z1', 'z2']),
  collection('playlist:gone', 'playlist', 'Orphan mix', ['o1'])
]
const entries = [
  entry('f1', ['liked']),
  entry('a', ['playlist:p1']),
  entry('b', ['playlist:p1']),
  entry('z1', ['album:z1'], 'viby-media://album-cover'),
  entry('z2', ['album:z1']),
  entry('o1', ['playlist:gone'])
]

const savedAlbums = [
  {
    id: 'z1',
    title: 'Album Z saved',
    artist: 'Artist',
    releaseType: 'Album',
    trackCount: 2,
    savedAt: 2
  },
  {
    id: 'q1',
    title: 'Saved EP',
    artist: 'Artist',
    releaseType: 'EP',
    trackCount: 4,
    savedAt: 1
  }
]

const items = buildLibraryItems(
  favorites,
  [playlistA, playlistB],
  savedAlbums,
  collections,
  entries
)
const byId = new Map(items.map((item) => [item.id, item]))

console.log('\nlibrary grid:')
check(
  'liked + playlists + saved releases + orphan, no download duplicates',
  items.map((item) => item.id).join(',') ===
    'liked,playlist:p1,playlist:p2,saved-album:z1,saved-album:q1,collection:playlist:gone',
  items.map((item) => item.id).join(',')
)
check('liked is partially downloaded', byId.get('liked')?.mark === 'partial')
check(
  'liked counts only downloaded favourites',
  byId.get('liked')?.downloaded === 1 && byId.get('liked')?.total === 2
)
check(
  'playlist partial progress',
  byId.get('playlist:p1')?.mark === 'partial' &&
    byId.get('playlist:p1')?.progress === (2 / 3) * 100
)
check(
  'playlist subtitle states coverage',
  byId.get('playlist:p1')?.subtitle === 'Playlist · 2 of 3 downloaded',
  byId.get('playlist:p1')?.subtitle
)
check('untouched playlist has no badge', byId.get('playlist:p2')?.mark === 'none')
check(
  'a saved, downloaded album keeps one tile with the local cover and full mark',
  byId.get('saved-album:z1')?.mark === 'full' &&
    byId.get('saved-album:z1')?.art === 'viby-media://album-cover' &&
    byId.get('saved-album:z1')?.kind === 'album' &&
    byId.get('saved-album:z1')?.album?.id === 'z1'
)
check(
  'a saved release without a download is still a tile',
  byId.get('saved-album:q1')?.mark === 'none' &&
    byId.get('saved-album:q1')?.subtitle === 'EP · 4 songs',
  byId.get('saved-album:q1')?.subtitle
)
check(
  'downloaded playlist without a library entry still appears',
  byId.get('collection:playlist:gone')?.title === 'Orphan mix' &&
    byId.get('collection:playlist:gone')?.ref.kind === 'download'
)
check(
  'playlist finds its first cover',
  byId.get('playlist:p1')?.art === 'https://img/a.jpg'
)

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
