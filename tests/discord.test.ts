/**
 * Discord Rich Presence: frame codec, activity mapping, rate limiting and the
 * IPC client. The socket test speaks the real protocol against a fake Discord
 * server, so no Discord install is needed here. Run: node tests/unit.mjs discord
 */
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PresenceSnapshot } from '../src/shared/types'
import { buildActivity, DISCORD_BADGE_URL, type DiscordActivity } from '../src/main/discord/activity'
import { DiscordIpcClient } from '../src/main/discord/client'
import { DISCORD_OPCODE, FrameDecoder, encodeFrame } from '../src/main/discord/frame'
import { discordIpcPaths } from '../src/main/discord/paths'
import { DiscordPresence, type PresenceClient } from '../src/main/discord/presence'
import { UpdateRateLimiter } from '../src/main/discord/rate-limit'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

console.log('frame codec:')
{
  const encoded = encodeFrame(DISCORD_OPCODE.handshake, { v: 1, client_id: '123' })
  check('header opcode is little-endian', encoded.readUInt32LE(0) === DISCORD_OPCODE.handshake)
  check('header length matches the payload', encoded.readUInt32LE(4) === encoded.length - 8)
  check('payload is JSON', JSON.parse(encoded.subarray(8).toString('utf8')).client_id === '123')

  const decoder = new FrameDecoder()
  const frame = encodeFrame(DISCORD_OPCODE.frame, { hello: 'world' })
  check('split chunks reassemble', decoder.push(frame.subarray(0, 3)).length === 0)
  const reassembled = decoder.push(frame.subarray(3))
  check('one frame decoded', reassembled.length === 1, String(reassembled.length))
  check('decoded payload intact', (reassembled[0].data as { hello: string }).hello === 'world')

  const two = Buffer.concat([frame, encodeFrame(DISCORD_OPCODE.frame, { n: 2 })])
  check('two frames in one chunk', new FrameDecoder().push(two).length === 2)

  const bad = Buffer.concat([Buffer.from([1, 0, 0, 0, 2, 0, 0, 0]), Buffer.from('??')])
  check('malformed JSON is dropped, not thrown', new FrameDecoder().push(bad).length === 0)

  const huge = Buffer.alloc(8)
  huge.writeUInt32LE(DISCORD_OPCODE.frame, 0)
  huge.writeUInt32LE(5_000_000, 4)
  let threw = false
  try {
    new FrameDecoder().push(huge)
  } catch {
    threw = true
  }
  check('oversized frames are rejected', threw)
}

console.log('\nsocket paths:')
{
  const win = discordIpcPaths('win32', {})
  check('windows tries ten pipes', win.length === 10)
  check('windows pipe format', win[0] === '\\\\?\\pipe\\discord-ipc-0', win[0])

  const mac = discordIpcPaths('darwin', { TMPDIR: '/var/tmp/' })
  check('macOS uses the temp dir', mac[0] === join('/var/tmp/', 'discord-ipc-0'), mac[0])
}

console.log('\nactivity mapping:')
{
  const track = {
    id: 'abc123def45',
    title: 'Instant Crush',
    artist: 'Daft Punk',
    artistId: 'UCdaftpunk',
    album: 'Random Access Memories',
    durationSec: 180,
    thumbnail: 'https://lh3.googleusercontent.com/x=w544'
  }
  const snap: PresenceSnapshot = {
    track,
    playing: true,
    position: 30,
    quality: 'AAC 130k',
    updatedAt: 100_000
  }
  const act = buildActivity(snap, 100_000)
  check('playing builds an activity', act !== null)
  if (act) {
    check('name is Viby', act.name === 'Viby')
    check('type is Listening', act.type === 2)
    check('details is the title', act.details === 'Instant Crush')
    check('details links the track', act.details_url === `https://music.youtube.com/watch?v=${track.id}`)
    check('state is the artist alone', act.state === 'Daft Punk')
    check('state links the artist', act.state_url === `https://music.youtube.com/channel/${track.artistId}`)
    check('member list shows the state field', act.status_display_type === 1)
    check('start projects from position', act.timestamps?.start === 70_000, String(act.timestamps?.start))
    check('end adds the duration', act.timestamps?.end === 250_000, String(act.timestamps?.end))
    check('large image is the thumbnail', act.assets?.large_image === track.thumbnail)
    check('large text is the album', act.assets?.large_text === track.album)
    check('large url links the track', act.assets?.large_url === `https://music.youtube.com/watch?v=${track.id}`)
    check('small image is the vinyl badge', act.assets?.small_image === DISCORD_BADGE_URL)
    check('small text is the quality', act.assets?.small_text === 'Playing · AAC 130k')
    check(
      'one Get Viby button',
      act.buttons?.length === 1 && act.buttons[0].label === 'Get Viby'
    )
  }

  // A delayed update must keep the same start time: position advances by the
  // elapsed time between the snapshot and the send.
  const delayed = buildActivity(snap, 104_000)
  check('start is stable across a delayed send', delayed?.timestamps?.start === 70_000)

  check('paused clears the presence', buildActivity({ ...snap, playing: false }, 100_000) === null)
  check('no track clears the presence', buildActivity({ ...snap, track: null }, 100_000) === null)

  const longTitle = buildActivity(
    { track: { ...track, title: 'x'.repeat(200) }, playing: true, position: 0, updatedAt: 0 },
    0
  )
  check('long titles truncate to 128', longTitle?.details?.length === 128, String(longTitle?.details?.length))
  check('truncation ends with an ellipsis', longTitle?.details?.endsWith('…'))

  const longState = buildActivity(
    { track: { ...track, artist: 'y'.repeat(200), album: 'z'.repeat(100) }, playing: true, position: 0, updatedAt: 0 },
    0
  )
  check('long artist truncates to 128', longState?.state?.length === 128)

  const http = buildActivity(
    { track: { ...track, thumbnail: 'http://example.com/x.jpg' }, playing: true, position: 0, updatedAt: 0 },
    0
  )
  check('non-https art falls back to i.ytimg', http?.assets?.large_image === 'https://i.ytimg.com/vi/abc123def45/hqdefault.jpg')

  const longThumb = buildActivity(
    { track: { ...track, thumbnail: `https://x.com/${'a'.repeat(400)}` }, playing: true, position: 0, updatedAt: 0 },
    0
  )
  check('oversized art falls back to i.ytimg', longThumb?.assets?.large_image === 'https://i.ytimg.com/vi/abc123def45/hqdefault.jpg')

  const noId = buildActivity(
    { track: { ...track, id: 'not-a-video-id', thumbnail: undefined }, playing: true, position: 0, updatedAt: 0 },
    0
  )
  check('no usable art drops the large image', noId?.assets?.large_image === undefined)

  const customBadge = buildActivity(snap, 100_000, 'https://example.com/badge.gif')
  check('a custom badge URL is used', customBadge?.assets?.small_image === 'https://example.com/badge.gif')

  const noArtistId = buildActivity(
    { ...snap, track: { ...track, artistId: undefined } },
    100_000
  )
  check(
    'without an artist id the name becomes a search link',
    noArtistId?.state_url === `https://music.youtube.com/search?q=${encodeURIComponent(track.artist)}`
  )

  const noQuality = buildActivity({ ...snap, quality: undefined }, 100_000)
  check('the hover falls back to Playing', noQuality?.assets?.small_text === 'Playing')

  const badArtistId = buildActivity(
    { ...snap, track: { ...track, artistId: 'not-a-channel' } },
    100_000
  )
  check(
    'an invalid artist id falls back to a search link',
    badArtistId?.state_url === `https://music.youtube.com/search?q=${encodeURIComponent(track.artist)}`
  )

  const badBadge = buildActivity(snap, 100_000, 'http://example.com/badge.gif')
  check('a non-https badge is dropped', badBadge?.assets?.small_image === undefined)

  const malformed = buildActivity(
    {
      track: {
        ...track,
        title: 42 as unknown as string,
        artist: null as unknown as string,
        durationSec: Number.NaN,
        thumbnail: null as unknown as string
      },
      playing: true,
      position: Number.NaN,
      updatedAt: Number.NaN,
      quality: 42 as unknown as string
    },
    100_000
  )
  check('malformed fields do not throw', malformed !== null)
  check('non-finite duration has no end', malformed?.timestamps?.end === undefined)
  check('non-finite position gives a finite start', Number.isFinite(malformed?.timestamps?.start))
  check('a malformed artist produces no state', malformed?.state === undefined)
  check(
    'a non-object track is ignored',
    buildActivity(
      {
        track: 'bad' as unknown as PresenceSnapshot['track'],
        playing: true,
        position: 0,
        updatedAt: 0
      },
      0
    ) === null
  )
}

console.log('\nrate limiter:')
{
  let t = 0
  const limiter = new UpdateRateLimiter(5, 20_000, () => t)
  check('first send is immediate', limiter.delay() === 0)
  limiter.record()
  check('a send inside the cap is still immediate', limiter.delay() === 0)

  for (let i = 0; i < 4; i++) {
    t += 1_000
    limiter.record()
  }
  check('the sixth send waits for the window', limiter.delay() === 16_000, String(limiter.delay()))
  t = 20_000
  check('window frees the earliest slot', limiter.delay() === 0, String(limiter.delay()))
  limiter.record()
  check('the next send waits again at the cap', limiter.delay() === 1_000, String(limiter.delay()))
  limiter.reset()
  check('reset clears the budget', limiter.delay() === 0)
}

console.log('\nclient over a real socket:')
{
  const path =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\viby-discord-test-${process.pid}`
      : join(tmpdir(), `viby-discord-test-${process.pid}.sock`)

  const received: Array<Record<string, unknown>> = []
  let serverSocket: net.Socket | null = null
  const server = net.createServer((socket) => {
    serverSocket = socket
    const decoder = new FrameDecoder()
    socket.on('data', (chunk) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.opcode === DISCORD_OPCODE.handshake) {
          received.push({ cmd: 'HANDSHAKE', data: frame.data as Record<string, unknown> })
          socket.write(
            encodeFrame(DISCORD_OPCODE.frame, {
              cmd: 'DISPATCH',
              evt: 'READY',
              data: { user: { id: '1', username: 'test' } }
            })
          )
        } else if (frame.opcode === DISCORD_OPCODE.pong) {
          received.push({ cmd: 'PONG', data: frame.data as Record<string, unknown> })
        } else if (frame.opcode === DISCORD_OPCODE.frame) {
          received.push(frame.data as Record<string, unknown>)
          const nonce = (frame.data as Record<string, unknown>).nonce
          if (typeof nonce === 'string') {
            socket.write(
              encodeFrame(DISCORD_OPCODE.frame, {
                cmd: 'SET_ACTIVITY',
                data: {},
                evt: null,
                nonce
              })
            )
          }
        }
      }
    })
  })

  await new Promise<void>((resolve) => server.listen(path, resolve))

  const client = new DiscordIpcClient({ clientId: '123', paths: [path], pid: 4242 })
  try {
    await client.open()
    check('client reports ready', client.isReady)

    const handshake = received.find((m) => m.cmd === 'HANDSHAKE')
    check(
      'handshake carries the client id',
      ((handshake?.data as { client_id?: string })?.client_id) === '123'
    )

    await client.setActivity({ name: 'Viby', type: 2, details: 'Song' })
    const set = received.find((m) => m.cmd === 'SET_ACTIVITY')
    check('activity sent', set !== undefined)
    check('pid sent', ((set?.args as { pid?: number })?.pid) === 4242, JSON.stringify(set?.args))
    check(
      'activity payload intact',
      ((set?.args as { activity?: { details?: string } })?.activity?.details) === 'Song'
    )

    await client.setActivity(null)
    const clear = received.filter((m) => m.cmd === 'SET_ACTIVITY').pop()
    check('clear sends a null activity', ((clear?.args as { activity?: unknown })?.activity) === null)

    serverSocket?.write(encodeFrame(DISCORD_OPCODE.ping, { nonce: 'ping-1' }))
    for (let i = 0; i < 20 && !received.some((m) => m.cmd === 'PONG'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    check('client answers ping with pong', received.some((m) => m.cmd === 'PONG'))
  } finally {
    client.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

console.log('\npresence manager:')
{
  class FakeClient implements PresenceClient {
    isReady = false
    activities: Array<DiscordActivity | null> = []
    opened = 0
    closed = false
    private closeHandler: (() => void) | null = null

    async open(): Promise<void> {
      this.opened += 1
      this.isReady = true
    }

    async setActivity(activity: DiscordActivity | null): Promise<void> {
      this.activities.push(activity)
    }

    close(): void {
      this.closed = true
      this.isReady = false
    }

    onClose(handler: () => void): void {
      this.closeHandler = handler
    }

    drop(): void {
      this.isReady = false
      this.closeHandler?.()
    }
  }

  const snapshot: PresenceSnapshot = {
    track: { id: 'a', title: 'Song', artist: 'Artist', durationSec: 60 },
    playing: true,
    position: 0,
    updatedAt: 0
  }

  let fake: FakeClient | null = null
  let nowMs = 0
  const manager = new DiscordPresence({
    clientId: '123',
    paths: [],
    createClient: () => {
      fake = new FakeClient()
      return fake
    },
    now: () => nowMs,
    updateLimit: 100,
    coalesceMs: 0,
    retryDelays: [100_000]
  })

  manager.setEnabled(true)
  await tick()
  check('enabled opens a connection', fake?.opened === 1 && fake?.isReady === true)

  manager.update(snapshot)
  await tick()
  check('playing sends an activity', fake?.activities.length === 1)
  check('activity is non-null while playing', fake?.activities[0] !== null)

  nowMs = 10_000
  manager.update({ ...snapshot, playing: false })
  await tick()
  check('paused sends a clear', fake?.activities.length === 2 && fake?.activities[1] === null)

  nowMs = 20_000
  manager.update({ ...snapshot, playing: false })
  await tick()
  check('a duplicate paused state does not resend', fake?.activities.length === 2)

  manager.update(null as unknown as PresenceSnapshot)
  await tick()
  check('a malformed snapshot is ignored', fake?.activities.length === 2)

  manager.setEnabled(false)
  check('disabling closes the client', fake?.closed === true)
  manager.stop()
}
{
  class FakeClientForRetry implements PresenceClient {
    isReady = false
    opened = 0
    async open(): Promise<void> {
      throw new Error('Discord is not running')
    }
    async setActivity(): Promise<void> {}
    close(): void {}
    onClose(): void {}
  }

  let fake: FakeClientForRetry | null = null
  const manager = new DiscordPresence({
    clientId: '123',
    paths: [],
    createClient: () => {
      fake = new FakeClientForRetry()
      return fake
    },
    retryDelays: [100_000]
  })
  manager.setEnabled(true)
  await tick()
  check('a failed connect schedules a retry instead of throwing', fake !== null && fake.opened === 0)
  manager.stop()
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
