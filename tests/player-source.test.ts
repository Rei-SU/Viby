/**
 * Player source ownership: a failed resolve must never make the next click
 * reuse the previous <audio> source under the new track's metadata.
 * Run: node tests/unit.mjs player-source
 */
import { sourceAction } from '../src/renderer/lib/player-source'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('source actions:')
check(
  'reuses the source only when current and loaded ids both match',
  sourceAction('track-a', 'track-a', 'track-a', true) === 'reuse'
)
check(
  'a failed resolve (current new, loaded old) detaches the old source',
  sourceAction('track-b', 'track-a', 'track-b', true) === 'detach'
)
check(
  'a detached element never counts as loaded',
  sourceAction('track-b', null, 'track-b', false) === 'detach'
)
check(
  'same loaded source with stale current metadata is kept',
  sourceAction('track-a', 'track-b', 'track-b', true) === 'keep'
)
check(
  'a loaded id without a source still resolves again',
  sourceAction('track-a', 'track-a', 'track-a', false) === 'keep'
)
check(
  'no current track detaches a source for another id',
  sourceAction(null, 'track-a', 'track-b', true) === 'detach'
)

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
