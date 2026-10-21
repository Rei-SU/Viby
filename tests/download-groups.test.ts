/**
 * Downloads page grouping: collection-owned songs must not appear again in the
 * loose Songs list, and artwork must fall back to the collection cover.
 * Run: node tests/unit.mjs download-groups
 */
import type { DownloadCollection, DownloadEntry } from '../src/shared/types'
import {
  collectionBytes,
  collectionEntries,
  collectionItems,
  collectionOwnedIds,
  entryArt,
  entryToItem,
  formatDuration,
  formatSize,
  standaloneEntries
} from '../src/renderer/lib/download-groups'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

function entry(
  id: string,
  sources: string[],
  artUrl?: string,
  thumbnail?: string
): DownloadEntry {
  return {
    track: {
      id,
      title: `Song ${id}`,
      artist: 'Artist',
      durationSec: 120,
      thumbnail
    },
    ext: 'm4a',
    bytes: 4 * 1024 * 1024,
    downloadedAt: 1,
    quality: 'best',
    artUrl,
    sources
  }
}

const album: DownloadCollection = {
  key: 'album:a1',
  kind: 'album',
  title: 'Album One',
  thumbnail: 'https://example.test/album.jpg',
  artUrl: 'viby-media://local/album-art.jpg',
  trackIds: ['a', 'b'],
  addedAt: 1
}
const playlist: DownloadCollection = {
  key: 'playlist:p1',
  kind: 'playlist',
  title: 'Playlist',
  thumbnail: 'https://example.test/pl.jpg',
  trackIds: ['c', 'b'],
  addedAt: 2
}

const entries = [
  entry('a', ['album:a1']),
  entry('b', ['album:a1', 'playlist:p1']),
  entry('c', ['playlist:p1']),
  entry('d', ['track:d'], undefined, 'https://example.test/d.jpg'),
  entry('e', ['track:e', 'album:gone'])
]
const collections = [album, playlist]

console.log('grouping:')
check(
  'collection-owned tracks are identified',
  [...collectionOwnedIds(collections, entries)].sort().join(',') === 'a,b,c',
  [...collectionOwnedIds(collections, entries)].sort().join(',')
)
check(
  'only loose downloads stay in Songs',
  standaloneEntries(collections, entries).map((item) => item.track.id).join(',') === 'd,e',
  standaloneEntries(collections, entries)
    .map((item) => item.track.id)
    .join(',')
)
check(
  'a track whose old collection is gone counts as standalone',
  standaloneEntries(collections, entries).some((item) => item.track.id === 'e')
)

console.log('\ncollection contents:')
check(
  'album keeps its track order',
  collectionEntries(album, entries).map((item) => item.track.id).join(',') === 'a,b',
  collectionEntries(album, entries)
    .map((item) => item.track.id)
    .join(',')
)
check(
  'playlist keeps its own order',
  collectionEntries(playlist, entries).map((item) => item.track.id).join(',') === 'c,b',
  collectionEntries(playlist, entries)
    .map((item) => item.track.id)
    .join(',')
)
check('missing entries are skipped', collectionEntries({ ...album, trackIds: ['a', 'zz'] }, entries).length === 1)
check('collection byte total', collectionBytes(album, entries) === 8 * 1024 * 1024)

console.log('\nartwork:')
check(
  'entry artwork wins',
  entryArt(entry('a', ['album:a1'], 'viby-media://own'), collections) === 'viby-media://own'
)
check(
  'album cover covers tracks without their own art',
  entryArt(entry('a', ['album:a1']), collections) === 'viby-media://local/album-art.jpg'
)
check(
  'remote thumbnail is the last resort',
  entryArt(entry('d', ['track:d'], undefined, 'https://example.test/d.jpg'), collections) ===
    'https://example.test/d.jpg'
)
check(
  'artwork survives into the row item',
  entryToItem(entry('a', ['album:a1']), collections).thumbnail ===
    'viby-media://local/album-art.jpg'
)
check(
  'collection rows fall back to the collection cover',
  collectionItems({ ...album, artUrl: 'viby-media://cover' }, entries)[0]?.thumbnail ===
    'viby-media://cover'
)

console.log('\nformatting:')
check('megabytes', formatSize(12 * 1024 * 1024) === '12 MB', formatSize(12 * 1024 * 1024))
check('gigabytes', formatSize(2.5 * 1024 ** 3) === '2.5 GB', formatSize(2.5 * 1024 ** 3))
check('zero', formatSize(0) === '0 MB')
check('short duration', formatDuration(125) === '2:05', formatDuration(125))
check('long duration', formatDuration(3725) === '1:02:05', formatDuration(3725))

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
