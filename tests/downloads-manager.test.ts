/**
 * Download progress parsing and failure classification. Run:
 *   node tests/unit.mjs downloads-manager
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DownloadManager, downloadIdFor, parseProgressLine, transient } from '../src/main/downloads/manager'
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
  check('bare 5xx retries', transient('ERROR: HTTP Error 502: Bad Gateway'))
  check('private video is permanent', !transient('ERROR: Private video. Sign in if you have access'))
  check('unavailable is permanent', !transient('ERROR: Video unavailable'))
  check('bot check is permanent', !transient('ERROR: Sign in to confirm you are not a bot'))
  check('a network error about a missing video is permanent', !transient('network error: video not found'))
}

console.log('\naudio-first download target:')
{
  const base: Track = { id: 'v', title: 'Video', artist: 'Artist', durationSec: 170 }
  const video: Track = { ...base, videoType: 'video' }
  const audio: Track = { ...base, id: 'a', videoType: 'audio' }
  check('a video row uses the known audio id', downloadIdFor(video, 'audio-id') === 'audio-id')
  check('a video row falls back when no audio exists', downloadIdFor(video, null) === 'v')
  check('an audio row ignores the alternate', downloadIdFor(audio, 'audio-id') === 'a')
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

console.log('\npause and resume:')
{
  const root = mkdtempSync(join(tmpdir(), 'viby-pause-'))
  const store = new DownloadsStore(root)
  const manager = new DownloadManager(store, {
    // Offline keeps pump() from launching yt-dlp; state changes still apply.
    isOffline: () => true,
    onProgress: () => undefined,
    onChanged: () => undefined,
    onCompleted: () => undefined
  })
  const a: Track = { id: 'a', title: 'A', artist: 'Artist', durationSec: 100 }
  const b: Track = { id: 'b', title: 'B', artist: 'Artist', durationSec: 100 }
  const states = (): string => `${store.job('a')?.state},${store.job('b')?.state}`

  manager.addTrack(a, 'best')
  manager.addCollection(
    { key: 'album:x', kind: 'album', title: 'X', trackIds: ['a', 'b'] },
    [a, b],
    'best'
  )
  check('both jobs queued', states() === 'queued,queued', states())

  manager.pause('a')
  check('pause marks the job paused', store.job('a')?.state === 'paused')
  check('user pause is recorded', store.job('a')?.pausedByUser === true)
  check('the other job is untouched', store.job('b')?.state === 'queued')

  manager.resume('a')
  check('resume queues the job', store.job('a')?.state === 'queued')
  check('user pause is cleared', store.job('a')?.pausedByUser === false)

  manager.pauseCollection('album:x')
  check('the collection pauses', states() === 'paused,paused', states())
  manager.resumeCollection('album:x')
  check('the collection resumes', states() === 'queued,queued', states())

  manager.pause('b')
  new DownloadManager(store, {
    isOffline: () => true,
    onProgress: () => undefined,
    onChanged: () => undefined,
    onCompleted: () => undefined
  }).start()
  check(
    'a user pause survives a restart',
    store.job('b')?.state === 'paused' && store.job('b')?.pausedByUser === true
  )
  // start() parks every resumable job as paused before pumping; the flag is the
  // difference between "will resume when online" and "stays paused".
  check('a quit-time pause is still resumable', store.job('a')?.pausedByUser !== true)
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
