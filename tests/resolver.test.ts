/**
 * End-to-end resolver test, run outside Electron with a stubbed `app` module.
 *
 * This is the regression test for the bug where a failing yt-dlp run printed the
 * literal string "null" on stdout and exit code 1, which we treated as data —
 * producing "Cannot read properties of null (reading 'id')" and hiding the real
 * reason. Run with:
 *
 *   npx esbuild tests/resolver.test.ts --bundle --platform=node --format=esm \
 *     --alias:@shared=./src/shared --alias:electron=./tests/electron-stub.ts \
 *     --outfile=/tmp/resolver.mjs && node /tmp/resolver.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Resolver, ResolveError } from '../src/main/ytdlp/resolver'
import { runnerInfo } from '../src/main/ytdlp/binary'

let failures = 0

function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

async function expectFailure(label: string, input: string, wantKind: string): Promise<void> {
  const started = Date.now()
  try {
    const result = await resolver.resolve(input)
    check(label, false, `resolved instead of failing: ${result.track.id}`)
  } catch (err) {
    const ms = Date.now() - started
    const isResolveError = err instanceof ResolveError
    const kind = isResolveError ? (err as ResolveError).kind : 'TypeError/other'
    const message = err instanceof Error ? err.message : String(err)
    check(
      label,
      kind === wantKind && !/Cannot read properties? of null/.test(message),
      `${ms}ms, kind=${kind}, message="${message.slice(0, 90)}"`
    )
  }
}

const resolver = new Resolver()

console.log('resolver regression tests\n')

const info = await runnerInfo()
console.log(`runner: ${info.kind} · ${info.runtime} · ${info.version} · ${info.path}\n`)
check('runs on the vendored Python (no system dependency)', info.runtime === 'bundled', info.runtime)

// The exact failure that reached the user: a video that does not exist. Before
// the fix this crashed with "Cannot read properties of null (reading 'id')".
await expectFailure('unavailable video gives a readable reason', 'aaaaaaaaaaa', 'unavailable')

// A playlist link is an import target, not something to hand to yt-dlp.
await expectFailure(
  'playlist link is rejected with a clear message',
  'https://music.youtube.com/playlist?list=PLw-VjHDlEOgvtnnnqXhfvfOdlFTBz5SxS',
  'playlist'
)

// Cancelling must be reported as a cancel, not as a 60-second timeout.
try {
  const controller = new AbortController()
  controller.abort()
  await resolver.resolve('dQw4w9WgXcQ', { signal: controller.signal, force: true })
  check('aborted resolve reports cancellation', false, 'resolved anyway')
} catch (err) {
  check(
    'aborted resolve reports cancellation',
    err instanceof ResolveError && (err as ResolveError).kind === 'cancelled',
    err instanceof Error ? err.message : String(err)
  )
}

// And the happy path still works: a real track resolves to something playable.
try {
  const started = Date.now()
  const result = await resolver.resolve('dQw4w9WgXcQ')
  const elapsed = Date.now() - started
  check(
    'real track resolves to a playable stream',
    Boolean(result.stream.url) && result.track.title.length > 0,
    `${elapsed}ms, client=${result.client}, kind=${result.stream.kind}, ` +
      `${result.stream.ext}${result.stream.bitrateKbps ? ` ${result.stream.bitrateKbps}kbps` : ''}, ` +
      `"${result.track.title.slice(0, 40)}"`
  )
  check('cold resolve is fast enough to stream', elapsed < 8_000, `${elapsed}ms (target < 8000ms)`)

  // In-memory hit: the path a hover prefetch leaves behind for the click.
  const cachedStart = Date.now()
  const again = await resolver.resolve('https://music.youtube.com/watch?v=dQw4w9WgXcQ')
  const cachedMs = Date.now() - cachedStart
  check(
    'warm resolve is instant',
    cachedMs < 50 && again.stream.url === result.stream.url,
    `${cachedMs}ms`
  )
  check('hasCached knows about it', resolver.hasCached('dQw4w9WgXcQ'))

  // Data saver: the ceiling must actually be applied, and the result must be
  // keyed separately so a quality switch cannot reuse the wrong stream URL.
  const capped = await resolver.resolve('dQw4w9WgXcQ', { maxKbps: 64, force: true })
  const cappedKbps = capped.stream.bitrateKbps ?? 0
  check(
    'data saver stays under the ceiling',
    Boolean(capped.stream.url) && cappedKbps > 0 && cappedKbps <= 70,
    `${capped.stream.ext} ${cappedKbps}kbps`
  )
  check(
    'data saver does not reuse the best-quality URL',
    capped.stream.url !== result.stream.url,
    `${cappedKbps}kbps vs ${result.stream.bitrateKbps ?? '?'}kbps`
  )
  check('quality tiers cache separately', resolver.hasCached('dQw4w9WgXcQ', 64))

  // Disk hit: what makes a restart feel instant.
  const file = join(mkdtempSync(join(tmpdir(), 'viby-urlcache-')), 'stream-urls.json')
  resolver.attachUrlCache(file)
  await resolver.resolve('dQw4w9WgXcQ')
  await new Promise((r) => setTimeout(r, 1_200))

  const fresh = new Resolver()
  fresh.attachUrlCache(file)
  const diskStart = Date.now()
  const fromDisk = await fresh.resolve('dQw4w9WgXcQ')
  const diskMs = Date.now() - diskStart
  check(
    'URL cache survives a restart',
    diskMs < 50 && fromDisk.stream.url === result.stream.url,
    `${diskMs}ms from disk`
  )
} catch (err) {
  check('real track resolves to a playable stream', false, err instanceof Error ? err.message : String(err))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
