/**
 * Lyric line selection. Run: node tests/unit.mjs lyrics-sync
 */
import { lineIndexAt } from '../src/renderer/lib/lyrics-sync'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const lines = [
  { time: 0, text: 'first' },
  { time: 4.5, text: 'second' },
  { time: 10, text: 'third' },
  { time: 10, text: 'fourth' }
]

console.log('line selection:')
check('nothing before the first timestamp', lineIndexAt(lines, -0.01) === -1)
check('first timestamp activates its line', lineIndexAt(lines, 0) === 0)
check('time between lines keeps the earlier one', lineIndexAt(lines, 7) === 1)
check('exact later timestamp activates immediately', lineIndexAt(lines, 10) === 3)
check('duplicate timestamps resolve to the last line', lineIndexAt(lines, 10.5) === 3)
check('past the end keeps the last line', lineIndexAt(lines, 999) === 3)
check('empty lyrics select nothing', lineIndexAt([], 5) === -1)

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
