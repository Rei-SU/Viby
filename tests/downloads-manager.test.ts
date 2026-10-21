/**
 * Download progress parsing and failure classification. Run:
 *   node tests/unit.mjs downloads-manager
 */
import { parseProgressLine, transient } from '../src/main/downloads/manager'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('progress with a known total:')
{
  const p = parseProgressLine('5242880 10485760 NA 1048576.0')
  check('downloaded bytes', p.downloadedBytes === 5242880, `${p.downloadedBytes}`)
  check('total bytes', p.totalBytes === 10485760, `${p.totalBytes}`)
  check('percent', p.percent === 50, `${p.percent}`)
  check('speed', p.speedBps === 1048576)
}

console.log('\nprogress with only an estimate:')
{
  const p = parseProgressLine('1000 NA 4000 500')
  check('falls back to the estimate', p.totalBytes === 4000, `${p.totalBytes}`)
  check('percent from estimate', p.percent === 25, `${p.percent}`)
}

console.log('\nprogress with unknown totals stays indeterminate:')
{
  const p = parseProgressLine('1000 NA NA NA')
  check('no total', p.totalBytes === undefined)
  check('no percent', p.percent === undefined)
  check('bytes still reported', p.downloadedBytes === 1000)
}

console.log('\nzero total does not divide by zero:')
{
  const p = parseProgressLine('0 0 NA NA')
  check('no percent for an empty total', p.percent === undefined)
}

console.log('\ntransient vs permanent failures:')
{
  check('timeout retries', transient('ERROR: socket timeout'))
  check('network error retries', transient('unable to download video data: HTTP Error 503'))
  check('private video is permanent', !transient('ERROR: Private video. Sign in if you have access'))
  check('unavailable is permanent', !transient('ERROR: Video unavailable'))
  check('bot check is permanent', !transient('ERROR: Sign in to confirm you are not a bot'))
  check('a network error about a missing video is permanent', !transient('network error: video not found'))
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
