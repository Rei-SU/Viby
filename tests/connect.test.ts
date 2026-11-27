/**
 * Device channel service: presence merge, throttled publish, claim/command
 * routing and teardown. Run: node tests/unit.mjs connect
 */
import {
  ConnectService,
  advanceSnapshot,
  type ConnectChannel,
  type ConnectChannelFactory,
  type ConnectChannelHandlers
} from '../src/main/connect/service'
import type { ConnectDevice, ConnectSnapshot } from '../src/shared/connect'
import { asCommand, asDevice, asSession, COMMAND_MAX_AGE_MS } from '../src/main/connect/validate'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const SELF = 'self-device-0001'
const OTHER = 'peer-device-0002'

const snapshot = (over: Partial<ConnectSnapshot> = {}): ConnectSnapshot => ({
  track: { id: 't1', title: 'Song', artist: 'Artist', durationSec: 180 },
  playing: true,
  position: 12,
  volume: 0.6,
  muted: false,
  claimAt: 0,
  updatedAt: 1000,
  ...over
})

const device = (over: Partial<ConnectDevice> = {}): ConnectDevice => ({
  id: OTHER,
  name: 'Other Mac',
  platform: 'macOS',
  ...snapshot(),
  ...over
})

type Harness = {
  service: ConnectService
  handlers: () => ConnectChannelHandlers
  tracked: ConnectDevice[]
  sent: unknown[]
  states: string[]
  left: () => boolean
  now: { value: number }
}

function harness(presenceGapMs = 1_000): Harness & { created: () => number } {
  let handlers: ConnectChannelHandlers | null = null
  const tracked: ConnectDevice[] = []
  const sent: unknown[] = []
  let left = false
  let created = 0
  const now = { value: 10_000 }
  const factory: ConnectChannelFactory = (_topic, _key, next) => {
    created += 1
    handlers = next
    const channel: ConnectChannel = {
      track: async (payload) => {
        tracked.push(payload)
      },
      send: async (payload) => {
        sent.push(payload)
      },
      leave: async () => {
        left = true
      }
    }
    return channel
  }
  const service = new ConnectService({
    deviceId: SELF,
    name: 'This Mac',
    platform: 'macOS',
    createChannel: factory,
    now: () => now.value,
    presenceGapMs,
    stateGapMs: 5,
    retryBaseMs: 50
  })
  const states: string[] = []
  service.onState((state) => states.push(JSON.stringify(state)))
  return {
    service,
    handlers: () => {
      if (!handlers) throw new Error('channel was not created')
      return handlers
    },
    tracked,
    sent,
    states,
    left: () => left,
    created: () => created,
    now
  }
}

console.log('channel lifecycle:')
{
  const h = harness()
  h.service.useAccount('user-1')
  check('a channel is created per account', h.states.length === 1)
  h.service.useAccount('user-1')
  check('the same account is a no-op', h.states.length === 1)
  h.service.useAccount('user-2')
  check('switching accounts leaves the old channel', h.left())
  check('a switched account is unavailable until joined', JSON.parse(h.states.at(-1)!).available === false)
  h.service.useAccount(null)
  check('signing out reports unavailable', JSON.parse(h.states.at(-1)!).available === false)
  h.service.dispose()
}

console.log('\npublish, presence and claims:')
{
  const h = harness()
  h.service.useAccount('user-1')
  h.handlers().onAvailable(true)
  h.service.publish(snapshot())
  await sleep(20)
  check('presence carries this device', h.tracked.length === 1 && h.tracked[0].id === SELF)
  check('the state broadcast follows', h.sent.some((m) => (m as { type?: string }).type === 'state'))
  const state = JSON.parse(h.states.at(-1)!)
  check('self is always listed', state.devices.some((d: ConnectDevice) => d.id === SELF))

  h.service.publish(snapshot({ claimAt: 5000 }))
  await sleep(5)
  const claims = h.sent.filter((m) => (m as { type?: string }).type === 'claim')
  check('a new claim is broadcast once', claims.length === 1, String(claims.length))
  h.service.publish(snapshot({ claimAt: 5000, position: 30 }))
  await sleep(5)
  check('the same claim is not repeated', h.sent.filter((m) => (m as { type?: string }).type === 'claim').length === 1)

  h.handlers().onDevices([device(), { id: 'bad' }, device({ id: SELF })])
  const merged = JSON.parse(h.states.at(-1)!)
  check('presence merges valid peers', merged.devices.some((d: ConnectDevice) => d.id === OTHER))
  check('malformed and self payloads are dropped', merged.devices.filter((d: ConnectDevice) => d.id === SELF).length === 1)

  h.handlers().onMessage({ type: 'state', device: device({ playing: false }) })
  const afterState = JSON.parse(h.states.at(-1)!)
  check('a state broadcast updates a peer', afterState.devices.find((d: ConnectDevice) => d.id === OTHER)?.playing === false)

  h.handlers().onMessage({ type: 'state', device: device({ playing: true }) })
  h.handlers().onDevices([device({ playing: false })])
  check('presence sync is authoritative again', JSON.parse(h.states.at(-1)!).devices.find((d: ConnectDevice) => d.id === OTHER)?.playing === false)

  h.handlers().onMessage({ type: 'state', device: device({ position: 50, updatedAt: 5_000 }) })
  check('a state broadcast applies', JSON.parse(h.states.at(-1)!).devices.find((d: ConnectDevice) => d.id === OTHER)?.position === 50)
  h.handlers().onDevices([device({ position: 10, updatedAt: 4_000 })])
  check(
    'an older presence snapshot cannot rewind a peer',
    JSON.parse(h.states.at(-1)!).devices.find((d: ConnectDevice) => d.id === OTHER)?.position === 50
  )
  h.handlers().onMessage({ type: 'state', device: device({ position: 5, updatedAt: 4_000 }) })
  check(
    'an older state broadcast is ignored',
    JSON.parse(h.states.at(-1)!).devices.find((d: ConnectDevice) => d.id === OTHER)?.position === 50
  )
  h.handlers().onMessage({ type: 'state', device: device({ position: 60, updatedAt: 5_000 }) })
  check(
    'an equal-timestamp state update still applies',
    JSON.parse(h.states.at(-1)!).devices.find((d: ConnectDevice) => d.id === OTHER)?.position === 60
  )
  h.service.dispose()
}

console.log('\ncommands and claims:')
{
  const h = harness()
  const commands: string[] = []
  const claims: number[] = []
  h.service.onCommand((command) => commands.push(command.kind))
  h.service.onClaim((claim) => claims.push(claim.at))
  h.service.useAccount('user-1')
  h.handlers().onAvailable(true)

  const base = { id: 'c1', from: OTHER, target: SELF, issuedAt: h.now.value }
  h.handlers().onMessage({ type: 'command', command: { ...base, kind: 'pause' } })
  check('a targeted command is forwarded', commands.join() === 'pause')
  h.handlers().onMessage({ type: 'command', command: { ...base, id: 'c2', target: OTHER, kind: 'pause' } })
  check('a command for another device is dropped', commands.length === 1)
  h.handlers().onMessage({
    type: 'command',
    command: { ...base, id: 'c3', issuedAt: h.now.value - COMMAND_MAX_AGE_MS - 1, kind: 'next' }
  })
  check('a stale command is dropped', commands.length === 1)
  h.handlers().onMessage({ type: 'command', command: { ...base, id: 'c4', kind: 'transfer-in', session: null } })
  check('a malformed transfer is dropped', commands.length === 1)

  h.handlers().onMessage({ type: 'claim', claim: { deviceId: OTHER, at: 777 } })
  check('a peer claim is forwarded', claims.join() === '777')
  h.handlers().onMessage({ type: 'claim', claim: { deviceId: SELF, at: 888 } })
  check('our own claim echo is ignored', claims.length === 1)

  const result = await h.service.send({ kind: 'play', target: OTHER })
  const sentCommand = h.sent.map((m) => m as { type?: string; command?: { from?: string; kind?: string } })
    .find((m) => m.type === 'command')
  check('send resolves ok', result.ok === true)
  check('the command carries this device as sender', sentCommand?.command?.from === SELF && sentCommand?.command?.kind === 'play')

  h.service.useAccount(null)
  const offline = await h.service.send({ kind: 'play', target: OTHER })
  check('send fails while signed out', offline.ok === false)
  h.service.dispose()
}

console.log('\npresence limit and rejoin:')
{
  const h = harness(0)
  h.service.useAccount('user-1')
  h.handlers().onAvailable(true)
  for (let i = 0; i < 6; i++) h.service.publish(snapshot({ position: i }))
  check('presence stays within four calls per 30 s', h.tracked.length <= 4, String(h.tracked.length))
  check('at least one presence call went out', h.tracked.length >= 1)
  h.service.dispose()

  const r = harness()
  r.service.useAccount('user-1')
  r.handlers().onAvailable(true)
  r.handlers().onAvailable(false)
  check('a lost channel keeps its single subscription', r.created() === 1)
  await sleep(160)
  check('the channel is recreated after the error', r.created() === 2, String(r.created()))
  r.handlers().onAvailable(true)
  check(
    'a successful rejoin is available again',
    JSON.parse(r.states.at(-1)!).available === true
  )
  r.service.dispose()
}

console.log('\nfresh presence samples:')
{
  const playing = device({
    playing: true,
    position: 10,
    updatedAt: 1_000,
    track: { id: 't', title: 'T', artist: 'A', durationSec: 600 }
  })
  const advanced = advanceSnapshot(playing, 11_000)
  check(
    'a heartbeat advances a playing snapshot',
    advanced.position === 20 && advanced.updatedAt === 11_000
  )
  const clamped = advanceSnapshot(
    device({
      playing: true,
      position: 595,
      updatedAt: 0,
      track: { id: 't', title: 'T', artist: 'A', durationSec: 600 }
    }),
    10_000
  )
  check('the advance clamps to the track', clamped.position === 600)
  const paused = advanceSnapshot(device({ playing: false, position: 10, updatedAt: 1_000 }), 11_000)
  check('a paused snapshot is untouched', paused.position === 10 && paused.updatedAt === 1_000)
}

console.log('\nvalidation:')
{
  check('a session clamps its index into the queue', (() => {
    const session = asSession({
      track: { id: 't', title: 'T', artist: 'A', durationSec: 1 },
      queue: [{ id: 'a', title: 'A', artist: 'A', durationSec: 1 }],
      index: 9,
      position: -2,
      playing: true,
      shuffle: false,
      repeat: 'all'
    })
    return session?.index === 0 && session?.position === 0 && session?.repeat === 'all'
  })())
  check('a session without tracks is rejected', asSession({ queue: [], track: null, index: 0, position: 0 }) === null)
  check('a device needs an id and a name', asDevice({ id: 'short', name: 'n' }) === null)
  const seek = asCommand(
    {
      id: 'seek-1',
      from: OTHER,
      target: SELF,
      issuedAt: 5,
      kind: 'seek',
      trackId: 'track-a',
      position: -4
    },
    SELF,
    10
  )
  check(
    'a seek keeps its track and clamps to zero',
    seek?.kind === 'seek' && seek.trackId === 'track-a' && seek.position === 0
  )
  check(
    'a seek without a track is rejected',
    asCommand(
      { id: 'seek-2', from: OTHER, target: SELF, issuedAt: 5, kind: 'seek', position: 10 },
      SELF,
      10
    ) === null
  )
  check('a command from another sender is accepted only for this device', (() => {
    const command = asCommand(
      {
        id: 'x',
        from: OTHER,
        target: SELF,
        issuedAt: 5,
        kind: 'volume',
        volume: 1
      },
      SELF,
      10
    )
    return command?.kind === 'volume'
  })())
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
