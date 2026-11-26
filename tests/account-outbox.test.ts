/**
 * The durable outbox: coalescing, ordering, replay after restart and the
 * in-flight edit rule that keeps a change made while a push was underway.
 * Run: node tests/unit.mjs account-outbox
 */
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Outbox, outboxKey, type OutboxRecord } from '../src/main/account/outbox'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const dir = mkdtempSync(join(tmpdir(), 'viby-outbox-'))
process.env.VIBY_TEST_USERDATA = dir
const file = join(dir, 'account-outbox.json')

const rec = (
  kind: OutboxRecord['kind'],
  recordId: string,
  payload: unknown,
  updatedAt = 1000,
  deviceId = 'device-a',
  deleted = false
): OutboxRecord => ({ kind, recordId, payload, updatedAt, deviceId, deleted })

console.log('coalescing:')
{
  const outbox = new Outbox(file)
  check('a new outbox is empty', outbox.count() === 0)

  outbox.put(rec('favorite', 'a', { id: 'a', title: 'A', v: 1 }))
  check('put adds a record', outbox.count() === 1)

  outbox.put(rec('favorite', 'a', { id: 'a', title: 'A', v: 2 }, 2000))
  check('a second write for the same record coalesces', outbox.count() === 1)
  check('the newer payload wins', (outbox.all()[0]?.payload as { v: number }).v === 2)
  check('the newer timestamp wins', outbox.all()[0]?.updatedAt === 2000)

  outbox.put(rec('album', 'a', { id: 'a' }))
  check('the same id in another kind stays separate', outbox.count() === 2)
  check('keys are kind-scoped', outboxKey(outbox.all()[0]!) !== outboxKey(outbox.all()[1]!))

  outbox.putAll([
    rec('playlist', 'p1', { id: 'p1', v: 1 }),
    rec('playlist', 'p1', { id: 'p1', v: 2 }),
    rec('playlist', 'p2', { id: 'p2' })
  ])
  check('putAll coalesces inside one batch', outbox.count() === 4)
  const p1 = outbox.all().find((entry) => entry.kind === 'playlist' && entry.recordId === 'p1')
  check('the last copy in a batch wins', (p1?.payload as { v: number }).v === 2)

  outbox.putAll([])
  check('an empty batch changes nothing', outbox.count() === 4)

  outbox.put({ ...rec('favorite', 'bad', {}), updatedAt: Number.NaN })
  check('an invalid record is not queued', outbox.count() === 4)
  outbox.put({ ...rec('favorite', 'bad', {}), kind: 'download' as OutboxRecord['kind'] })
  check('an unknown kind is not queued', outbox.count() === 4)
}

console.log('\nordering and peek:')
{
  const paged = new Outbox(join(dir, 'paged.json'))
  for (let i = 0; i < 5; i++) paged.put(rec('favorite', `f${i}`, { i }, i))
  check('peek takes the oldest entries', paged.peek(2).map((r) => r.recordId).join(',') === 'f0,f1')
  check('peek respects the limit', paged.peek(10).length === 5)
  check('a zero limit returns nothing', paged.peek(0).length === 0)
  check('a negative limit returns nothing', paged.peek(-1).length === 0)
  check('peek does not consume', paged.count() === 5)
}

console.log('\nreplay and removal:')
{
  const replay = new Outbox(join(dir, 'replay.json'))
  const first = rec('favorite', 'r1', { v: 1 }, 1000)
  replay.put(first)
  replay.put(rec('favorite', 'r2', { v: 1 }, 1000))

  // A change made while the push is in flight replaces the queued copy.
  const batch = replay.peek(10)
  replay.put({ ...first, payload: { v: 2 }, updatedAt: 3000 })
  replay.removePushed(batch)
  check('a record changed mid-flight stays queued', replay.count() === 1)
  check('the in-flight edit is the one kept', (replay.all()[0]?.payload as { v: number }).v === 2)

  const rest = replay.peek(10)
  replay.removePushed(rest)
  check('a completed push empties the queue', replay.count() === 0)

  const keys = new Outbox(join(dir, 'keys.json'))
  keys.putAll([rec('favorite', 'k1', {}), rec('album', 'k2', {}), rec('history', 'k3', {})])
  keys.removeKeys([outboxKey(rec('favorite', 'k1', {})), outboxKey(rec('history', 'k3', {}))])
  check('removeKeys drops exactly the named records', keys.all().map((r) => r.recordId).join(',') === 'k2')
  keys.clear()
  check('clear empties the queue', keys.count() === 0)
}

console.log('\npersistence:')
{
  const path = join(dir, 'persist.json')
  const first = new Outbox(path)
  first.putAll([rec('favorite', 'x', { v: 1 }, 1234), rec('setting', 'shuffle', { value: true })])
  const second = new Outbox(path)
  check('a new instance replays the queue', second.count() === 2)
  check('payloads survive', (second.all().find((r) => r.recordId === 'x')?.payload as { v: number }).v === 1)
  check('device ids survive', second.all().every((r) => r.deviceId === 'device-a'))

  const raw = readFileSync(path, 'utf8')
  check('the queue is plain JSON on disk', JSON.parse(raw).records.length === 2)
}

console.log('\nrepairing a hand-edited file:')
{
  const path = join(dir, 'damaged.json')
  writeFileSync(
    path,
    JSON.stringify({
      records: [
        { kind: 'favorite', recordId: 'good', payload: {}, updatedAt: 1, deviceId: 'd', deleted: false },
        { kind: 'download', recordId: 'bad-kind', payload: {}, updatedAt: 1, deviceId: 'd', deleted: false },
        { kind: 'favorite', recordId: '', payload: {}, updatedAt: 1, deviceId: 'd', deleted: false },
        { kind: 'favorite', recordId: 'no-ts', payload: {}, updatedAt: 'x', deviceId: 'd', deleted: false },
        { kind: 'favorite', recordId: 'no-flag', payload: {}, updatedAt: 1, deviceId: 'd' }
      ]
    })
  )
  const repaired = new Outbox(path)
  check('only usable records are kept', repaired.count() === 1, String(repaired.count()))
  check('the surviving record is intact', repaired.all()[0]?.recordId === 'good')

  const rewritten = JSON.parse(readFileSync(path, 'utf8'))
  check('the repair is written back', rewritten.records.length === 1)

  const arrayPath = join(dir, 'array.json')
  writeFileSync(arrayPath, JSON.stringify({ records: 'not-an-array' }))
  check('a non-array queue reads as empty', new Outbox(arrayPath).count() === 0)

  const junkPath = join(dir, 'junk.json')
  writeFileSync(junkPath, 'not json at all')
  check('an unparseable file reads as empty', new Outbox(junkPath).count() === 0)
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
