import {
  artistNames,
  artistPartsFor,
  creditParts,
  creditRange,
  isArtistName,
  isSeparator,
  splitArtistParts
} from '../src/shared/artist-credits'
import { plainTrack } from '../src/renderer/lib/track'
import type { SubtitlePart, Track } from '../src/shared/types'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const texts = (parts: SubtitlePart[]): string => parts.map((part) => part.text).join('')

// ---- creditParts: the leading credit run of a catalog row -----------------
const row: SubtitlePart[] = [
  { text: 'Stormy', artistId: 'UCstormy', entity: 'artist' },
  { text: ', ' },
  { text: 'Manal', artistId: 'UCmanal', entity: 'artist' },
  { text: ' · ' },
  { text: 'Sata 9ttala', albumId: 'MPREb_x', entity: 'album' }
]
const credit = creditParts(row) ?? []
check('credit run stops at the album', credit.length === 3, JSON.stringify(credit))
check('credit run keeps both artist ids', credit[0]?.artistId === 'UCstormy' && credit[2]?.artistId === 'UCmanal')
check('credit run keeps the separator', credit[1]?.text === ', ')
check('credit run rebuilds the display string', texts(credit) === 'Stormy, Manal', texts(credit))

check('album-only parts have no credit run', creditParts([row[4]]) === undefined)
check('trailing separators are trimmed', texts(creditParts([row[0], row[1]]) ?? []) === 'Stormy')
check('empty parts produce no credit run', creditParts([]) === undefined)
check('feat. is not an artist name', isArtistName({ text: 'feat.' }) === false)
check('punctuation is a separator', isSeparator({ text: ' & ' }) === true)

const radio: SubtitlePart[] = [
  { text: 'Alpha', artistId: 'UCalpha', entity: 'artist' },
  { text: ' • ' },
  { text: 'Beta', artistId: 'UCbeta', entity: 'artist' },
  { text: ' • ' },
  { text: '1.8B views' }
]
const radioCredit = creditParts(radio) ?? []
check('radio byline keeps only artists and separators', texts(radioCredit) === 'Alpha • Beta', texts(radioCredit))

// YouTube omits the browse endpoint for some featured credits (observed on
// Future / WE DON'T TRUST YOU: The Weeknd and Kendrick Lamar arrive as plain
// runs). They are still artists and must stay in the credit run.
const plainFeature: SubtitlePart[] = [
  { text: 'Future', artistId: 'UCfuture', entity: 'artist' },
  { text: ', ' },
  { text: 'Metro Boomin', artistId: 'UCmetro', entity: 'artist' },
  { text: ' & ' },
  { text: 'The Weeknd' }
]
const featureCredit = creditParts(plainFeature) ?? []
check('a featured name without an id stays in the credit run', texts(featureCredit) === 'Future, Metro Boomin & The Weeknd', texts(featureCredit))
check(
  'every credited name is still an artist',
  artistNames(featureCredit).join('|') === 'Future|Metro Boomin|The Weeknd',
  artistNames(featureCredit).join('|')
)
check('the credit range covers the plain feature', creditRange(plainFeature).join(',') === '0,5')

// Release and artist cards share the subtitle renderer; their captions must
// never become fake artist links.
check('a bare year is not an artist', isArtistName({ text: '2023' }) === false)
check(
  'an album card has no credit run',
  creditParts([{ text: 'Album' }, { text: ' • ' }, { text: '2023' }]) === undefined
)
check(
  'an artist card monthly audience is a counter',
  creditParts([{ text: 'Artist' }, { text: ' • ' }, { text: '68.3M monthly audience' }]) ===
    undefined
)
check(
  'a playlist track count is a counter',
  creditRange([
    { text: 'Alpha', artistId: 'UCalpha', entity: 'artist' },
    { text: ' • ' },
    { text: '40 songs' }
  ]).join(',') === '0,1'
)

// ---- splitArtistParts: fallback for combined strings ----------------------
const split = splitArtistParts('Stormy, Manal')
check('comma splits two names', texts(split) === 'Stormy, Manal', texts(split))
check('comma split links each name separately', split.filter((part) => part.entity === 'artist').length === 2)
check('separator parts carry no entity', split[1]?.entity === undefined)

const withId = splitArtistParts('Stormy, Manal', 'UCstormy')
check('stored id goes to the primary credit only', withId[0]?.artistId === 'UCstormy' && withId[2]?.artistId === undefined)

const ampersand = splitArtistParts('Yung Vision & Young Lime')
check('spaced ampersand splits', artistNames(ampersand).join('|') === 'Yung Vision|Young Lime', artistNames(ampersand).join('|'))

check('R&B is not split', splitArtistParts('R&B').length === 1)
check('AC/DC is not split', splitArtistParts('AC/DC').length === 1)
check('Malcolm X is not split', splitArtistParts('Malcolm X').length === 1)

for (const [label, value] of [
  ['feat.', 'A feat. B'],
  ['featuring', 'A featuring B'],
  ['ft.', 'A ft. B'],
  ['x', 'A x B'],
  ['with', 'A with B'],
  ['plus', 'A + B']
] as const) {
  check(`${label} splits`, artistNames(splitArtistParts(value)).join('|') === 'A|B', artistNames(splitArtistParts(value)).join('|'))
}

check('dangling connector stays one name', splitArtistParts('A feat.').length === 1)
check('empty name has no parts', splitArtistParts('   ').length === 0)
check('Unknown artist has no parts', splitArtistParts('Unknown artist').length === 0)
check(
  'single name keeps its id',
  splitArtistParts('Stormy', 'UCstormy')[0]?.artistId === 'UCstormy'
)

// ---- artistPartsFor: structured data wins over guessing -------------------
const structured: SubtitlePart[] = [
  { text: 'A', artistId: 'UCa', entity: 'artist' },
  { text: ' & ' },
  { text: 'B', artistId: 'UCb', entity: 'artist' }
]
const structuredTrack = { artist: 'Different Name', artistId: 'UCa', artistParts: structured }
check(
  'stored parts win over the display string',
  texts(artistPartsFor(structuredTrack)) === 'A & B' &&
    artistPartsFor(structuredTrack)[0]?.artistId === 'UCa'
)
check('legacy track is split from its name', texts(artistPartsFor({ artist: 'Stormy, Manal', artistId: 'UCstormy' })) === 'Stormy, Manal')
check('legacy single-artist track stays one link', artistPartsFor({ artist: 'Stormy' }).length === 1)
check(
  'a legacy display string drops the row tag',
  artistNames(artistPartsFor({ artist: 'Song • ElGrandeToto', artistId: 'UCtoto' })).join('|') ===
    'ElGrandeToto'
)

// ---- rendering order ------------------------------------------------------
check('artistNames skips separators and connectors', artistNames(splitArtistParts('A feat. B')).join('|') === 'A|B')

// ---- IPC snapshots --------------------------------------------------------
// Svelte 5 state is a Proxy, and structured clone (every IPC call) rejects
// proxies even when they wrap plain data. A shallow spread stopped being a
// valid snapshot once Track gained the nested artistParts array.
const proxiedPart = new Proxy({ text: 'Stormy', artistId: 'UCstormy', entity: 'artist' as const }, {})
const proxiedTrack = {
  id: 'p1',
  title: 'Sata 9ttala',
  artist: 'Stormy, Manal',
  durationSec: 200,
  artistParts: [proxiedPart]
} as Track

let rawCloneFailed = false
try {
  structuredClone(proxiedTrack)
} catch {
  rawCloneFailed = true
}
check('a proxied track cannot be cloned', rawCloneFailed)

let snapshot: Track | null = null
try {
  snapshot = structuredClone(plainTrack(proxiedTrack))
} catch {
  snapshot = null
}
check(
  'plainTrack makes the IPC snapshot cloneable',
  snapshot?.artistParts?.[0]?.text === 'Stormy' && snapshot.artist === proxiedTrack.artist,
  JSON.stringify(snapshot)
)
check('plainTrack leaves the original alone', proxiedTrack.artistParts?.[0]?.text === 'Stormy')

// ---- page-type labels are tags, not credits -------------------------------
const searchRow: SubtitlePart[] = [
  { text: 'Song' },
  { text: ' • ' },
  { text: 'ElGrandeToto', artistId: 'UCtoto', entity: 'artist' }
]
const searchCredit = creditParts(searchRow) ?? []
check('the leading "Song" tag is not a credit', texts(searchCredit) === 'ElGrandeToto', texts(searchCredit))
check('the artist keeps its id', searchCredit[0]?.artistId === 'UCtoto')
check(
  'artistNames never include the page-type tag',
  artistNames(searchCredit).join('|') === 'ElGrandeToto',
  artistNames(searchCredit).join('|')
)

const storedPolluted: Track = {
  id: 'x',
  title: 'Mghayer',
  artist: 'Song • ElGrandeToto',
  artistId: 'UCtoto',
  artistParts: searchRow,
  durationSec: 214
}
const sanitized = artistPartsFor(storedPolluted)
check('stored credits are cleaned on read', artistNames(sanitized).join('|') === 'ElGrandeToto')
check('a real artist named after a tag is still kept', creditParts([
  { text: 'Song', artistId: 'UCsong', entity: 'artist' },
  { text: ', ' },
  { text: 'Manal', artistId: 'UCmanal', entity: 'artist' }
])?.[0]?.artistId === 'UCsong')

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nartist-credits: all checks passed')
