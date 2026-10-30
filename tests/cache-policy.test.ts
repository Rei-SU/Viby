/**
 * Cache-worthiness predicate. Run: node tests/unit.mjs cache-policy
 */
import { shouldCache, type CacheDecisionInput } from '../src/main/cache/policy'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const base: CacheDecisionInput = {
  favorited: false,
  inOwnedPlaylist: false,
  completion: 0,
  playCount: 0
}

console.log('cache-worthiness:')
check('a one-off stream is not cached', shouldCache(base) === false)
check('a favourite is cached', shouldCache({ ...base, favorited: true }) === true)
check('a track in an owned playlist is cached', shouldCache({ ...base, inOwnedPlaylist: true }) === true)
check('half played is enough', shouldCache({ ...base, completion: 0.5 }) === true)
check('below half is not enough', shouldCache({ ...base, completion: 0.49 }) === false)
check('played twice is enough', shouldCache({ ...base, playCount: 2 }) === true)
check('played once is not enough', shouldCache({ ...base, playCount: 1 }) === false)
check(
  'full completion covers a single play',
  shouldCache({ ...base, completion: 1, playCount: 1 }) === true
)
check(
  'negative input stays a miss',
  shouldCache({ ...base, completion: -1, playCount: -2 }) === false
)

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
