import assert from 'node:assert/strict'
import type { RunResult } from '../src/main/ytdlp/exec'
import { Resolver, ResolveError } from '../src/main/ytdlp/resolver'

const cachedId = '00000000001'
const blockedId = '00000000002'
const otherId = '00000000003'
const now = Date.now
let time = now()
let calls = 0
let failure = ''

const resolver = new Resolver(
  async (): Promise<RunResult> => {
    calls++
    return failure
      ? { code: 1, stdout: 'null', stderr: failure, timedOut: false }
      : {
          code: 0,
          stdout: JSON.stringify({
            id: cachedId,
            formats: [{ url: 'https://example.com/track', protocol: 'https', vcodec: 'none', acodec: 'opus' }]
          }),
          stderr: '',
          timedOut: false
        }
  },
  async () => ({ command: 'fake', prefix: [], path: 'fake', kind: 'binary' })
)

const errorKind = (kind: ResolveError['kind']): ((error: unknown) => boolean) =>
  (error) => error instanceof ResolveError && error.kind === kind

try {
  Date.now = () => time
  const cached = await resolver.resolve(cachedId)
  failure = 'ERROR: Sign in to confirm you are not a bot.'
  await assert.rejects(resolver.resolve(blockedId), errorKind('botcheck'))

  time += 30_000
  assert.equal(await resolver.resolve(cachedId), cached)
  await assert.rejects(resolver.resolve(otherId), errorKind('rate-limited'))
  await assert.rejects(resolver.download(otherId, undefined, undefined, true), errorKind('rate-limited'))
  assert.equal(calls, 2, 'cache hits and blocked requests never start another process')

  time += 30_000
  failure = 'ERROR: HTTP Error 429: Too Many Requests'
  await assert.rejects(resolver.resolve(otherId), errorKind('rate-limited'))
  assert.equal(calls, 3, 'requests can reach yt-dlp again when the cooldown expires')

  failure = ''
  await resolver.resolve('https://example.com/elsewhere')
  await assert.rejects(resolver.resolve(otherId), errorKind('rate-limited'))
  assert.equal(calls, 4, 'a YouTube restriction does not affect other sources')

  time += 60_000
  failure = 'ERROR: Sign in to confirm your age.'
  await assert.rejects(resolver.resolve(otherId), errorKind('unknown'))
  failure = ''
  await resolver.resolve(otherId)
  assert.equal(calls, 6, 'a track-specific sign-in error does not start a cooldown')
} finally {
  Date.now = now
}

console.log('  PASS  YouTube resolver cooldown')
