/**
 * Library artwork cache: content-addressed files, served over viby-media, with
 * deduplication and a bounded on-disk footprint.
 * Run: node tests/unit.mjs images
 */
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImageCache } from '../src/main/cache/images'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const dir = mkdtempSync(join(tmpdir(), 'viby-images-'))
const remote = 'https://example.test/art/cover.jpg'
const bytes = new Uint8Array([1, 2, 3, 4, 5])
let calls = 0

const cache = new ImageCache(dir, async () => {
  calls += 1
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes.length) }
  })
})

const run = async (): Promise<void> => {
  console.log('cache:')
  const first = await cache.cache(remote)
  check('returns a local media URL', Boolean(first?.startsWith('viby-media://')), first)
  check('one network call', calls === 1, String(calls))

  const file = join(dir, cache.nameFor(remote, 'jpg'))
  check('content-addressed file exists', existsSync(file))
  check('bytes are written', existsSync(file) && statSync(file).size === bytes.length)

  const second = await cache.cache(remote)
  check('second hit reuses the file', second === first && calls === 1, `${second} / ${calls}`)

  const local = 'viby-media://local/already.jpg'
  check('local URLs pass through', cache.localUrl(local) === local)
  check('missing URL has no answer', cache.localUrl('https://example.test/none.jpg') === undefined)

  console.log('\nbulk + stats:')
  const many = await cache.cacheMany([remote, 'https://example.test/art/two.png'])
  check('bulk resolves both', Boolean(many[remote]) && Boolean(many['https://example.test/art/two.png']))
  check('bulk did not refetch the cached one', calls === 2, String(calls))

  const stats = cache.stats()
  check('stats count both files', stats.entries === 2, String(stats.entries))
  check('stats size both files', stats.bytes === bytes.length * 2, String(stats.bytes))

  cache.clear()
  check('clear empties the cache', cache.stats().entries === 0 && cache.stats().bytes === 0)
}

run()
  .catch((err) => {
    failures++
    console.error(err)
  })
  .finally(() => {
    rmSync(dir, { recursive: true, force: true })
    console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
    process.exit(failures === 0 ? 0 : 1)
  })
