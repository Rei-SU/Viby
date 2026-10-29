/**
 * Catalog-first metadata merging for the remembered track store.
 * Run: node tests/unit.mjs track-metadata
 */
import { mergeTrackMetadata } from '../src/main/track-metadata'
import type { Track } from '../src/shared/types'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const catalog: Track = {
  id: 'abc',
  title: 'Mghayer',
  artist: 'ElGrandeToto',
  artistId: 'UCtoto',
  artistParts: [{ text: 'ElGrandeToto', artistId: 'UCtoto', entity: 'artist' }],
  album: 'Caméléon',
  albumId: 'MPREb_toto',
  releaseType: 'Album',
  durationSec: 214,
  thumbnail: 'catalog-art',
  videoType: 'audio'
}

const resolver: Track = {
  id: 'abc',
  title: 'Mghayer',
  artist: 'ElGrandeToto - Topic',
  album: 'Caméléon',
  durationSec: 215,
  thumbnail: 'resolver-art',
  sourceUrl: 'https://www.youtube.com/watch?v=abc'
}

console.log('catalog metadata wins:')
const merged = mergeTrackMetadata(catalog, resolver)
check('artist parts stay catalog-shaped', merged.artistParts?.[0]?.artistId === 'UCtoto')
check('artist id survives', merged.artistId === 'UCtoto')
check('album id survives', merged.albumId === 'MPREb_toto')
check('release type survives', merged.releaseType === 'Album')
check('catalog thumbnail wins', merged.thumbnail === 'catalog-art')
check('the resolver still supplies the source url', merged.sourceUrl === resolver.sourceUrl)
check('a known duration is not overwritten', merged.durationSec === 214)

console.log('\nmissing fields are filled:')
const sparse: Track = { id: 'abc', title: 'Mghayer', artist: 'ElGrandeToto', durationSec: 0 }
const filled = mergeTrackMetadata(sparse, resolver)
check('duration comes from the resolver', filled.durationSec === 215)
check('thumbnail comes from the resolver', filled.thumbnail === 'resolver-art')
check('album name is kept for display', filled.album === 'Caméléon')
check('no album id is invented', filled.albumId === undefined)

console.log('\ncatalog-only growth:')
const nameOnly: Track = {
  id: 'abc',
  title: 'Mghayer',
  artist: 'ElGrandeToto',
  album: 'Caméléon',
  durationSec: 0
}
const laterCatalog: Track = { ...catalog, title: 'Mghayer', durationSec: 214 }
const promoted = mergeTrackMetadata(nameOnly, laterCatalog)
check('a later album id completes the pair', promoted.albumId === 'MPREb_toto')
check('the album name stays consistent', promoted.album === 'Caméléon')

console.log('\nunknown credits are repaired:')
const unknown: Track = { id: 'abc', title: 'Mghayer', artist: 'Unknown artist', durationSec: 0 }
const repaired = mergeTrackMetadata(unknown, catalog)
check('the placeholder artist is replaced', repaired.artist === 'ElGrandeToto')
check('its id comes along', repaired.artistId === 'UCtoto')

console.log('\nno previous record:')
const fresh = mergeTrackMetadata(undefined, resolver)
check('the incoming record is used as-is', fresh.title === 'Mghayer' && fresh.sourceUrl === resolver.sourceUrl)

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
