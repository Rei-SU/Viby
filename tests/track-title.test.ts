import { trackTitleKey } from '../src/shared/track-title'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const same = (a: string, b: string): boolean => trackTitleKey(a) === trackTitleKey(b)

check('an official video is the same recording', same('Instant Crush (Official Video)', 'Instant Crush'))
check('an official audio is the same recording', same('Instant Crush [Official Audio]', 'Instant Crush'))
check('a lyric video is the same recording', same('Instant Crush (Lyric Video)', 'Instant Crush'))
check('a visualizer is the same recording', same('Instant Crush (Visualizer)', 'Instant Crush'))
check('a 4K marker is not part of the title', same('Instant Crush [4K]', 'Instant Crush'))
check('case and extra spaces are ignored', same('  INSTANT   CRUSH  ', 'instant crush'))
check('a live version stays a different recording', !same('Instant Crush (Live)', 'Instant Crush'))
check('a remix stays a different recording', !same('Instant Crush (Remix)', 'Instant Crush'))
check('a featuring credit is not a version', same('Instant Crush (feat. Julian Casablancas)', 'Instant Crush'))
check('a trailing featuring credit is not a version', same('Instant Crush feat. Julian Casablancas', 'Instant Crush'))
check('"with" stays part of the title', same('Dance with Me', 'Dance with Me') && !same('Dance with Me', 'Dance'))
check('a live version with a feature is still live', same('Song (Live) (feat. X)', 'Song (Live)'))
check('an acoustic version stays a different recording', !same('Instant Crush (Acoustic)', 'Instant Crush'))
check('empty titles stay empty', trackTitleKey('') === '')

if (failures > 0) {
  console.error(`\ntrack-title: ${failures} check(s) failed`)
  process.exit(1)
}
console.log('\ntrack-title: all checks passed')
