/**
 * Audio cache: safe paths, index validation, LRU eviction, snapshots and
 * startup reconciliation. Run:
 *   node tests/unit.mjs audio-cache
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { AudioCache } from '../src/main/cache/audio'
import type { Track } from '../src/shared/types'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const root = mkdtempSync(join(tmpdir(), 'viby-audio-cache-'))
const incoming = join(root, 'incoming')
mkdirSync(incoming, { recursive: true })

let cap = 1024 * 1024
const cache = new AudioCache(join(root, 'audio'), () => cap)

function source(name: string, bytes = 1000): string {
  const file = join(incoming, name)
  writeFileSync(file, Buffer.alloc(bytes, 1))
  return file
}

const track = (id: string, title = id): Track => ({
  id,
  title,
  artist: 'The Neighbourhood',
  durationSec: 200,
  artistParts: [{ text: 'The Neighbourhood', entity: 'artist' }]
})

console.log('safe paths and extensions:')
const hostile = '../../escape'
const hostileFile = cache.put(hostile, source('a.m4a'), 'M4A', { track: track(hostile) })
check('a hostile id cannot escape the cache folder', hostileFile.startsWith(cache.path + '\\') || hostileFile.startsWith(cache.path + '/'))
check('the stored name is sanitized', /^[A-Za-z0-9_-]+\.m4a$/.test(basename(hostileFile)), basename(hostileFile))
check('the hit resolves through the same safe id', cache.lookup(hostile) === hostileFile)
check('an unknown container falls back to m4a', cache.extOf(hostile) === 'm4a')

console.log('\nsnapshots and quality:')
const snapshotSource = track('snap', 'Holy Ghost')
const snapFile = cache.put('snap', source('snap.webm', 2000), 'webm', {
  track: snapshotSource,
  quality: 'data-saver'
})
snapshotSource.title = 'Changed'
snapshotSource.artistParts![0].text = 'Changed'
const snapHit = cache.find('snap')
check('the hit keeps its container', snapHit?.ext === 'webm')
check('the hit keeps the original title', snapHit?.track?.title === 'Holy Ghost', snapHit?.track?.title)
check('artist credits are copied, not aliased', snapHit?.track?.artistParts?.[0]?.text === 'The Neighbourhood')
check('the quality tag survives', snapHit?.quality === 'data-saver')

console.log('\ncontainer changes:')
const oldWebm = join(cache.path, 'snap.webm')
cache.put('snap', source('snap.m4a', 2200), 'm4a', { track: snapshotSource })
check('the old container file is removed', !existsSync(oldWebm))
check('the new container is indexed', cache.extOf('snap') === 'm4a')
check('the new file exists', existsSync(snapFile.replace(/\.webm$/, '.m4a')))

console.log('\nLRU eviction:')
cap = 900
cache.put('a', source('a1.m4a', 400), 'm4a')
cache.put('b', source('b1.m4a', 400), 'm4a')
cache.put('c', source('c1.m4a', 400), 'm4a')
check('the least recently used entry is gone', !cache.has('a'))
check('the newer entries survive', cache.has('b') && cache.has('c'))
check('size stays under the cap', cache.bytes() <= cap, `${cache.bytes()} <= ${cap}`)

console.log('\nkeep protection:')
const keptCache = new AudioCache(join(root, 'keep-audio'), () => 900)
keptCache.put('a', source('ka.m4a', 400), 'm4a')
keptCache.put('b', source('kb.m4a', 400), 'm4a')
keptCache.put('c', source('kc.m4a', 400), 'm4a', { keepId: 'a' })
check('the protected entry survives', keptCache.has('a'))
check('a different entry is evicted', !keptCache.has('b'))
check('the incoming entry is stored', keptCache.has('c'))

console.log('\noversized incoming:')
const bigCache = new AudioCache(join(root, 'big-audio'), () => 500)
const bigFile = bigCache.put('big', source('big.m4a', 800), 'm4a')
check('a file larger than the cap is not evicted before it can play', existsSync(bigFile) && bigCache.has('big'))

console.log('\nquality invalidation:')
const qualityKeep = new AudioCache(join(root, 'quality-keep'), () => 1024 * 1024)
qualityKeep.put('playing', source('qk.m4a', 300), 'm4a', { quality: 'data-saver' })
qualityKeep.invalidateQuality('data-saver', 'playing')
check('the playing track keeps its saver copy', qualityKeep.has('playing'))
qualityKeep.invalidateQuality('data-saver')
check('the copy is removed once it is no longer protected', !qualityKeep.has('playing'))
cache.put('saver', source('saver.m4a', 300), 'm4a', { quality: 'data-saver' })
cache.put('best', source('best.m4a', 300), 'm4a', { quality: 'best' })
cache.invalidateQuality('data-saver')
check('the saver copy is gone', !cache.has('saver'))
check('the best copy stays', cache.has('best'))

console.log('\nhealing a missing file:')
cache.put('gone', source('gone.m4a', 300), 'm4a')
unlinkSync(join(cache.path, 'gone.m4a'))
check('lookup reports a miss', cache.lookup('gone') === null)
check('the stale index entry is dropped', cache.extOf('gone') === null)

console.log('\ntruncated file:')
cache.put('short', source('short.m4a', 500), 'm4a')
const shortFile = join(cache.path, 'short.m4a')
writeFileSync(shortFile, Buffer.alloc(100, 1))
check('a size mismatch is a miss', cache.lookup('short') === null)
check('the bad entry is dropped', cache.extOf('short') === null)
check('the unusable file is removed', !existsSync(shortFile))

console.log('\nremove and clear:')
cache.remove('best')
check('remove drops the file', !existsSync(join(cache.path, 'best.m4a')))
const clearCache = new AudioCache(join(root, 'clear-audio'), () => 1024 * 1024)
clearCache.put('a', source('ca.m4a', 300), 'm4a')
clearCache.put('b', source('cb.m4a', 300), 'm4a')
const cleared = clearCache.clear('a')
check('clear keeps the playing track', clearCache.has('a'))
check('clear removes everything else', !clearCache.has('b'))
check('clear reports one entry', cleared.entries === 1, String(cleared.entries))

console.log('\nreconcile:')
const reconRoot = join(root, 'recon')
const reconDir = join(reconRoot, 'audio')
mkdirSync(reconDir, { recursive: true })
writeFileSync(join(reconDir, 'ok.m4a'), Buffer.alloc(120, 1))
writeFileSync(join(reconDir, 'junk.txt'), Buffer.alloc(10, 1))
writeFileSync(join(reconDir, 'bad name.m4a'), Buffer.alloc(10, 1))
writeFileSync(join(reconDir, 'dup.m4a'), Buffer.alloc(150, 1))
writeFileSync(join(reconDir, 'dup.webm'), Buffer.alloc(160, 1))
// Make m4a unambiguously the newest duplicate.
utimesSync(join(reconDir, 'dup.m4a'), new Date(), new Date())
utimesSync(join(reconDir, 'dup.webm'), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
writeFileSync(
  join(reconDir, 'index.json'),
  JSON.stringify({
    entries: {
      dup: {
        ext: 'm4a',
        bytes: 150,
        lastUsed: 111,
        track: track('dup', 'Dup Song'),
        quality: 'best'
      },
      corrupt: { ext: 'exe', bytes: -1, lastUsed: 'never' }
    }
  })
)
const recon = new AudioCache(reconDir, () => 1_000_000)
recon.reconcile()
check('a valid orphan file is adopted', recon.has('ok'))
check('junk is removed', !existsSync(join(reconDir, 'junk.txt')))
check('an unsafe name is removed', !existsSync(join(reconDir, 'bad name.m4a')))
check('one extension survives per track', readdirSync(reconDir).filter((name) => name.startsWith('dup.')).length === 1)
check('the surviving extension matches the index', recon.extOf('dup') === 'm4a')
check('the snapshot is preserved', recon.find('dup')?.track?.title === 'Dup Song')
check('the quality tag is preserved', recon.find('dup')?.quality === 'best')
check('an invalid index entry is refused', recon.lookup('corrupt') === null)

console.log('\nreconcile enforces the cap at startup:')
const cappedRoot = join(root, 'capped')
const cappedDir = join(cappedRoot, 'audio')
mkdirSync(cappedDir, { recursive: true })
writeFileSync(join(cappedDir, 'old.m4a'), Buffer.alloc(800, 1))
writeFileSync(join(cappedDir, 'new.m4a'), Buffer.alloc(800, 1))
utimesSync(join(cappedDir, 'old.m4a'), new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
const capped = new AudioCache(cappedDir, () => 900)
capped.reconcile()
check('the oldest file is evicted', !capped.has('old'))
check('the newest file stays', capped.has('new'))

rmSync(root, { recursive: true, force: true })
console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
