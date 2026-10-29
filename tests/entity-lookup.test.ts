/**
 * Verified entity matching for name-only links. Run: node tests/unit.mjs entity-lookup
 */
import {
  normalizeEntityName,
  pickAlbum,
  pickArtist,
  primaryArtistName
} from '../src/renderer/lib/entity-lookup'
import type { CatalogItem, SubtitlePart } from '../src/shared/types'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

function item(partial: Partial<CatalogItem> & { id: string; title: string }): CatalogItem {
  return { kind: 'album', subtitle: '', ...partial }
}

console.log('name normalization:')
check('accents are ignored', normalizeEntityName('Caméléon') === normalizeEntityName('Cameleon'))
check('case and punctuation are ignored', normalizeEntityName('ElGrandeToto!') === 'elgrandetoto')
check('featuring suffixes are dropped', normalizeEntityName('Daft Punk feat. Pharrell') === 'daft punk')

const artists = [
  item({ id: 'UCtyler', browseId: 'UCtyler', kind: 'artist', title: 'Tyler, The Creator' }),
  item({ id: 'UCchilders', browseId: 'UCchilders', kind: 'artist', title: 'Tyler Childers' })
]
console.log('\nartist matching:')
check(
  'a comma name matches itself',
  pickArtist(artists, 'Tyler, The Creator')?.browseId === 'UCtyler'
)
check('a truncated name does not match', pickArtist(artists, 'Tyler') === null)
check('unknown names resolve to nothing', pickArtist(artists, 'Tyler Nobody') === null)

const albums = [
  item({
    id: 'MPREb_toto',
    browseId: 'MPREb_toto',
    title: 'Caméléon',
    subtitle: 'Album • ElGrandeToto • 2021',
    parts: [
      { text: 'Album' },
      { text: ' • ' },
      { text: 'ElGrandeToto', artistId: 'UCtoto', entity: 'artist' },
      { text: ' • ' },
      { text: '2021' }
    ]
  }),
  item({
    id: 'MPREb_other',
    browseId: 'MPREb_other',
    title: 'Cameleon',
    subtitle: 'Album • Somebody Else • 2018'
  }),
  item({
    id: 'MPREb_zkr',
    browseId: 'MPREb_zkr',
    title: 'Caméléon',
    subtitle: 'Album • ZKR • 2022'
  })
]

console.log('\nalbum matching:')
check(
  'title and artist both agree',
  pickAlbum(albums, 'Caméléon', 'ElGrandeToto')?.browseId === 'MPREb_toto'
)
check(
  'accented title matches an unaccented click',
  pickAlbum(albums, 'Cameleon', 'ElGrandeToto')?.browseId === 'MPREb_toto'
)
check('the same title under another artist is refused', pickAlbum(albums, 'Caméléon', 'Daft Punk') === null)
check('an artist is required to pick a release', pickAlbum(albums, 'Caméléon', undefined) === null)
check(
  'a subtitle-only credit still verifies',
  pickAlbum(albums, 'Cameleon', 'Somebody Else')?.browseId === 'MPREb_other'
)

console.log('\nprimary artist:')
const polluted: SubtitlePart[] = [
  { text: 'Song' },
  { text: ' • ' },
  { text: 'ElGrandeToto', artistId: 'UCtoto', entity: 'artist' }
]
check(
  'the page-type tag is skipped',
  primaryArtistName({ artist: 'Song • ElGrandeToto', artistParts: polluted }) === 'ElGrandeToto'
)
check(
  'a combined credit uses its first artist',
  primaryArtistName({ artist: 'Daft Punk, Pharrell Williams' }) === 'Daft Punk'
)

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
