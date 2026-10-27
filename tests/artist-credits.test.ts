import {
  artistNames,
  artistPartsFor,
  creditParts,
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
check('stored parts win over the display string', artistPartsFor(structuredTrack) === structured)
check('legacy track is split from its name', texts(artistPartsFor({ artist: 'Stormy, Manal', artistId: 'UCstormy' })) === 'Stormy, Manal')
check('legacy single-artist track stays one link', artistPartsFor({ artist: 'Stormy' }).length === 1)

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

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nartist-credits: all checks passed')
