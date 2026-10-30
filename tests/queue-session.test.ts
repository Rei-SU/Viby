/**
 * Queue session windows. Run: node tests/unit.mjs queue-session
 */
import { queueWindow, restoreQueue } from '../src/renderer/lib/queue-session'
import type { PlaybackSession, Track } from '../src/shared/types'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const track = (i: number): Track => ({
  id: `t${i}`,
  title: `Track ${i}`,
  artist: 'Artist',
  durationSec: 200
})
const queue = (n: number): Track[] => Array.from({ length: n }, (_, i) => track(i))

console.log('save window:')
{
  const short = queueWindow(queue(50), 42)
  check('a short queue is saved whole', short.queue.length === 50 && short.queueStart === 0)
  check('the current track is in the short window', short.queue[42]?.id === 't42')

  const start = queueWindow(queue(300), 0)
  check('the first track saves from zero', start.queueStart === 0)
  check('the window is capped', start.queue.length === 100, String(start.queue.length))

  const middle = queueWindow(queue(300), 150)
  check('a middle track keeps 20 rows before it', middle.queueStart === 130, String(middle.queueStart))
  check('the window stops at 100 rows', middle.queue.length === 100)
  check('the current track is inside the window', middle.queue[150 - middle.queueStart]?.id === 't150')

  const last = queueWindow(queue(300), 299)
  check(
    'the last track is always inside the window',
    last.queue[299 - last.queueStart]?.id === 't299'
  )
  check('the window ends at the queue end', last.queueStart === 200 && last.queue.length === 100)
}

console.log('\nrestore:')
{
  const saved = {
    track: track(150),
    queue: queue(300).slice(130, 230),
    index: 150,
    queueStart: 130,
    position: 12,
    updatedAt: 1
  } satisfies PlaybackSession
  const restored = restoreQueue(saved)
  check('the absolute index maps into the window', restored.index === 20, String(restored.index))
  check('the relative index resolves to the same track', restored.queue[restored.index]?.id === 't150')

  const legacy = {
    track: track(5),
    queue: queue(20),
    index: 5,
    position: 3,
    updatedAt: 1
  } satisfies PlaybackSession
  check('an old session without an offset still restores', restoreQueue(legacy).index === 5)

  const empty = { track: null, queue: [], index: -1, position: 0, updatedAt: 0 } satisfies PlaybackSession
  check('an empty session restores an empty queue', restoreQueue(empty).index === -1)
}

console.log('\nround trip:')
{
  const original = queue(300)
  for (const index of [0, 19, 20, 99, 150, 250, 299]) {
    const saved = queueWindow(original, index)
    const restored = restoreQueue({
      track: original[index],
      queue: saved.queue,
      index,
      queueStart: saved.queueStart,
      position: 0,
      updatedAt: 1
    })
    check(
      `index ${index} restores the same track`,
      restored.queue[restored.index]?.id === original[index].id,
      restored.queue[restored.index]?.id ?? 'none'
    )
  }
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
