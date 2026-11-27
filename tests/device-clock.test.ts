/**
 * Cross-device clock model: fresh samples only, latency-tolerant offset, and
 * no rewinding when a presence heartbeat repeats the last payload.
 * Run: node tests/unit.mjs device-clock
 */
import { DeviceClock } from '../src/renderer/lib/device-clock'
import type { ConnectDevice } from '../src/shared/connect'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const T0 = 1_700_000_000_000
/** This machine's clock runs 5 s ahead of the device's. */
const SKEW = 5_000
const ID = 'peer-device-0002'

const peer = (over: Partial<ConnectDevice> = {}): ConnectDevice => ({
  id: ID,
  name: 'Mac',
  platform: 'macOS',
  playing: true,
  position: 10,
  volume: 0.6,
  muted: false,
  claimAt: T0 - SKEW,
  updatedAt: T0 - SKEW,
  track: { id: 't', title: 'T', artist: 'A', durationSec: 600 },
  ...over
})

console.log('offset and position:')
{
  const clock = new DeviceClock()
  clock.observe([peer()], T0)
  check('a first sample measures the skew', clock.offsetOf(ID) === SKEW, String(clock.offsetOf(ID)))
  check('the position starts at the sample', clock.position(peer(), T0) === 10)
  check(
    'a playing device advances in real time',
    Math.abs(clock.position(peer(), T0 + 3_000) - 13) < 0.01
  )
}

console.log('\nheartbeats repeat without rewinding:')
{
  const clock = new DeviceClock()
  clock.observe([peer()], T0)
  // Presence re-sends the same payload 30 s later.
  clock.observe([peer()], T0 + 30_000)
  check('the repeat leaves the offset alone', clock.offsetOf(ID) === SKEW)
  check(
    'the song keeps its elapsed time instead of jumping back',
    Math.abs(clock.position(peer(), T0 + 30_000) - 40) < 0.01,
    String(clock.position(peer(), T0 + 30_000))
  )
}

console.log('\na fresh sample is believed as-is:')
{
  const clock = new DeviceClock()
  clock.observe([peer()], T0)
  clock.observe([peer({ position: 40, updatedAt: T0 + 30_000 - SKEW })], T0 + 30_000)
  check('the offset is confirmed', clock.offsetOf(ID) === SKEW)
  check(
    'the reported position matches',
    Math.abs(clock.position(peer({ position: 40, updatedAt: T0 + 30_000 - SKEW }), T0 + 30_000) - 40) < 0.01
  )
}

console.log('\nlatency and ordering:')
{
  const clock = new DeviceClock()
  clock.observe([peer()], T0)
  clock.observe([peer({ position: 60, updatedAt: T0 + 60_000 - SKEW })], T0 + 60_800)
  const offset = clock.offsetOf(ID) ?? 0
  check('a slow packet only nudges the offset', offset > SKEW && offset < SKEW + 100, String(offset))
  const shown = clock.position(peer({ position: 60, updatedAt: T0 + 60_000 - SKEW }), T0 + 60_800)
  check('and cannot jump the song', Math.abs(shown - 60.8) < 0.2, String(shown))

  const before = clock.offsetOf(ID)
  clock.observe([peer({ position: 1_000, updatedAt: T0 + 10_000 })], T0 + 61_500)
  check('an out-of-order sample is ignored', clock.offsetOf(ID) === before)
}

console.log('\npaused, stamping and pruning:')
{
  const clock = new DeviceClock()
  clock.observe([peer()], T0)
  check(
    'a paused device reports its sample position',
    clock.position(peer({ playing: false, position: 33 }), T0 + 90_000) === 33
  )
  check(
    'an optimistic stamp lands in the device clock',
    Math.abs(clock.stamp(ID, T0 + 90_000) - (T0 + 90_000 - SKEW)) < 100
  )

  const prune = new DeviceClock()
  prune.observe([peer()], T0)
  prune.observe([], T0 + 1_000)
  check('a device that leaves is forgotten', prune.offsetOf(ID) === undefined)
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
