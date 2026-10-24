/**
 * Download progress parsing and failure classification. Run:
 *   node tests/unit.mjs downloads-manager
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DownloadManager, parseProgressLine, transient } from '../src/main/downloads/manager'
import { DownloadsStore } from '../src/main/downloads/store'
import type { Track } from '../src/shared/types'

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

console.log('\ncredit repair for downloads saved without an artist:')
{
  const root = mkdtempSync(join(tmpdir(), 'viby-repair-'))
  const store = new DownloadsStore(root)
  const album = 'Hard To Imagine The Neighbourhood Ever Changing'
  const unknown = (id: string, title: string): Track => ({
    id,
    title,
    artist: 'Unknown artist',
    durationSec: 200
  })
  const put = (track: Track): void => {
    const dir = join(root, 'tmp', track.id)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${track.id}.m4a`)
    writeFileSync(file, Buffer.alloc(2048, 1))
    store.put(track, file, 'm4a', ['album:MPREb_test'], 'best')
  }
  put(unknown('a', 'Dust'))
  put(unknown('b', 'Scary Love'))
  // The old build pinned a wrong match for "Dust" (title-only search).
  store.putLyrics('a', { kind: 'plain', plain: 'Another one bites the dust' })
  store.addCollection({
    key: 'album:MPREb_test',
    kind: 'album',
    title: album,
    trackIds: ['a', 'b']
  })

  // Keep the lyrics backfill this triggers off the network.
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response('{}', { status: 404 })) as typeof fetch
  try {
    const manager = new DownloadManager(store, {
      isOffline: () => false,
      onProgress: () => undefined,
      onChanged: () => undefined,
      onCompleted: () => undefined,
      catalogAlbum: async () => ({
        // Real album rows have no per-row credit; the header holds the artist.
        header: {
          title: album,
          artist: { name: 'The Neighbourhood', id: 'UC1cnYMXqKdazz-gDPKaDFyg' }
        },
        items: [
          { id: 'a', kind: 'song', title: 'Dust', subtitle: '' },
          { id: 'b', kind: 'song', title: 'Scary Love', subtitle: '' }
        ]
      })
    })
    await manager.repairCredits()
    check('artist repaired', store.entry('a')?.track.artist === 'The Neighbourhood')
    check('album filled from the collection', store.entry('a')?.track.album === album)
    check('artist id kept', store.entry('a')?.track.artistId === 'UC1cnYMXqKdazz-gDPKaDFyg')
    check('second track repaired too', store.entry('b')?.track.artist === 'The Neighbourhood')
    check('stale lyrics dropped for a fresh lookup', store.lyrics('a') === null)
  } finally {
    globalThis.fetch = realFetch
  }
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
