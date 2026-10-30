/**
 * Audio-first selection must never cross artists. Run: node tests/unit.mjs audio-track-pick
 */
import {
  artistMatches,
  normalizeEntityName,
  pickAudioTrack,
  primaryArtistName,
  withFallbackArtist
} from '../src/shared/entity-identity'
import type { CatalogItem } from '../src/shared/types'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const song = (id: string, title: string, artists: string[], videoType = 'audio'): CatalogItem => ({
  id,
  kind: 'song',
  title,
  subtitle: '',
  artists,
  videoType
})

console.log('identity helpers:')
check('accents normalize away', normalizeEntityName('Caméléon') === normalizeEntityName('Cameleon'))
check('a page-type tag is not an artist', primaryArtistName('Song • The Neighbourhood') === 'The Neighbourhood')
check('a combined credit uses its first artist', primaryArtistName('The Neighbourhood, Pharrell') === 'The Neighbourhood')
check('artist match is exact and accent-insensitive', artistMatches('The Neighbourhood', 'The Neighbourhood') === true)
check('a different artist does not match', artistMatches('Desiigner', 'The Neighbourhood') === false)

console.log('\naudio track selection:')
check(
  'the credited artist wins over a same-titled song',
  pickAudioTrack(
    [song('d', 'Holy Ghost', ['Desiigner']), song('n', 'Holy Ghost', ['The Neighbourhood'])],
    'Holy Ghost',
    'The Neighbourhood'
  )?.id === 'n'
)
check(
  'a row without an artist is not guessed',
  pickAudioTrack([song('d', 'Holy Ghost', ['Desiigner'])], 'Holy Ghost', '') === null
)
check(
  'a same-titled song by someone else is refused',
  pickAudioTrack([song('d', 'Holy Ghost', ['Desiigner'])], 'Holy Ghost', 'The Neighbourhood') === null
)
check(
  'a version marker does not beat the plain recording',
  pickAudioTrack([song('r', 'Song (Remix)', ['A']), song('s', 'Song', ['A'])], 'Song', 'A')?.id === 's'
)
check(
  'a featuring credit still matches the primary artist',
  pickAudioTrack([song('n', 'Holy Ghost (feat. X)', ['The Neighbourhood'])], 'Holy Ghost', 'The Neighbourhood')
    ?.id === 'n'
)

console.log('\nartist fallback:')
const bare = { id: 'b', kind: 'song' as const, title: 'Start', subtitle: '' }
const filled = withFallbackArtist(bare, { name: 'The Neighbourhood', id: 'UCn' })
check('a bare row gains the page artist', filled.artists?.[0] === 'The Neighbourhood')
check('the fallback keeps the artist id', filled.parts?.[0]?.artistId === 'UCn')
check('the caption becomes the artist', filled.subtitle === 'The Neighbourhood')
check(
  'a credited row is left alone',
  withFallbackArtist(song('x', 'Start', ['Someone']), { name: 'The Neighbourhood' }).artists?.[0] ===
    'Someone'
)
check(
  'a linked row is left alone',
  withFallbackArtist(
    { ...bare, parts: [{ text: 'Someone', artistId: 'UCs', entity: 'artist' }] },
    { name: 'The Neighbourhood' }
  ).artists === undefined
)
check('no fallback changes nothing', withFallbackArtist(bare, null) === bare)

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
