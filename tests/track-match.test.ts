/**
 * Release-row matching for a clicked song. Run: node tests/unit.mjs track-match
 */
import { pickTrackIndex, releaseSearchTitle } from '../src/shared/track-match'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const album = [
  { id: 'v1', title: 'Give Life Back to Music', durationSec: 274 },
  { id: 'a2', title: 'Get Lucky (feat. Pharrell Williams and Nile Rodgers)', durationSec: 369 },
  { id: 'v2', title: 'Get Lucky (feat. Pharrell Williams and Nile Rodgers) (Official Video)', durationSec: 248 },
  { id: 'a3', title: 'Instant Crush (feat. Julian Casablancas)', durationSec: 337 }
]

console.log('exact ids win:')
check('the same row id matches even with a different title', pickTrackIndex(album, { id: 'a3', title: 'Something else' }) === 3)
check('an unknown id still matches by title', pickTrackIndex(album, { id: 'zzz', title: 'Get Lucky (feat. Pharrell Williams and Nile Rodgers)' }) >= 1)

console.log('title markers are ignored:')
check(
  'an official-video marker does not block the match',
  pickTrackIndex(album, { id: 'zzz', title: 'Get Lucky (feat. Pharrell Williams and Nile Rodgers) [Official Video]' }) >= 1
)

console.log('duplicate titles use duration:')
check(
  'the album cut is chosen by duration',
  pickTrackIndex(album, { title: 'Get Lucky (feat. Pharrell Williams and Nile Rodgers)', durationSec: 370 }) === 1
)
check(
  'the shorter version is chosen by duration',
  pickTrackIndex(album, { title: 'Get Lucky (feat. Pharrell Williams and Nile Rodgers)', durationSec: 247 }) === 2
)

console.log('a different recording matches nothing:')
check(
  'a radio edit does not light up the album cut',
  pickTrackIndex(album, { title: 'Get Lucky (Radio Edit)', durationSec: 248 }) === -1,
  String(pickTrackIndex(album, { title: 'Get Lucky (Radio Edit)', durationSec: 248 }))
)
check(
  'a mismatched duration refuses an ambiguous title',
  pickTrackIndex(album, {
    title: 'Get Lucky (feat. Pharrell Williams and Nile Rodgers)',
    durationSec: 100
  }) === -1
)

console.log('small releases:')
check('a missing title yields no match', pickTrackIndex(album, { title: 'Nope' }) === -1)
check('an empty release yields no match', pickTrackIndex([], { title: 'Get Lucky' }) === -1)
check(
  'a unique title matches without a duration',
  pickTrackIndex(album, { title: 'Instant Crush (feat. Julian Casablancas)' }) === 3
)

console.log('release search titles:')
check(
  'featuring and version qualifiers are dropped for the query',
  releaseSearchTitle('Instant Crush (feat. Julian Casablancas)') === 'Instant Crush'
)
check(
  'official markers are dropped for the query',
  releaseSearchTitle('Get Lucky (Official Video)') === 'Get Lucky'
)
check(
  'a plain title is unchanged',
  releaseSearchTitle('Mr. Brightside') === 'Mr. Brightside'
)

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
