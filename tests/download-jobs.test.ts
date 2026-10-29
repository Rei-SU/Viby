/**
 * Downloads panel grouping. Run: node tests/unit.mjs download-jobs
 */
import type {
  DownloadCollection,
  DownloadEntry,
  DownloadJobView,
  DownloadsSnapshot,
  Track
} from '../src/shared/types'
import { groupDownloadJobs } from '../src/renderer/lib/download-jobs'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

function track(id: string, title = id, thumbnail?: string): Track {
  return { id, title, artist: 'Artist', durationSec: 200, thumbnail }
}

function collection(key: string, title: string, trackIds: string[]): DownloadCollection {
  return {
    key,
    kind: key.startsWith('album:') ? 'album' : 'playlist',
    title,
    trackIds,
    addedAt: 1
  }
}

function entry(trackValue: Track, sources: string[]): DownloadEntry {
  return {
    track: trackValue,
    ext: 'm4a',
    bytes: 1000,
    downloadedAt: 1,
    quality: 'best',
    sources
  }
}

function job(
  trackValue: Track,
  sources: string[],
  state: DownloadJobView['state'],
  percent?: number
): DownloadJobView {
  return { trackId: trackValue.id, track: trackValue, sources, state, quality: 'best', attempts: 0, percent }
}

function snapshot(
  entries: DownloadEntry[],
  collections: DownloadCollection[],
  jobs: DownloadJobView[]
): DownloadsSnapshot {
  return {
    revision: 1,
    entries,
    collections,
    jobs,
    stats: { bytes: 0, entries: entries.length, freeBytes: null, dir: '/downloads' }
  }
}

console.log('grouping pending downloads:')
{
  const album = collection('album:a', 'Album A', ['a', 'b', 'c', 'd'])
  const playlist = collection('playlist:p', 'Playlist P', ['e', 'f'])
  const a = track('a')
  const b = track('b', 'B side', 'https://example.test/b.jpg')
  const c = track('c')
  const d = track('d', 'Loose')
  const e = track('e')

  const data = snapshot(
    [entry(a, ['album:a'])],
    [album, playlist],
    [
      job(b, ['album:a'], 'downloading', 50),
      job(c, ['album:a', 'playlist:p'], 'queued'),
      job(e, ['playlist:p'], 'queued'),
      job(d, ['track:d'], 'failed')
    ]
  )

  const groups = groupDownloadJobs(data)
  const byKey = new Map(groups.map((group) => [group.key, group]))

  const albumGroup = byKey.get('album:a')
  check('album group is first', groups[0]?.key === 'album:a', groups[0]?.key)
  check('album title comes from the collection', albumGroup?.title === 'Album A')
  check('completed entry counts toward coverage', albumGroup?.done === 1, String(albumGroup?.done))
  check('collection total comes from its track ids', albumGroup?.total === 4, String(albumGroup?.total))
  check('album group is downloading', albumGroup?.state === 'downloading')
  check('album progress includes the active fraction', Math.round(albumGroup?.percent ?? 0) === 38, String(albumGroup?.percent))
  check(
    'active job sorts before queued',
    albumGroup?.jobs.map((item) => item.trackId).join(',') === 'b,c',
    albumGroup?.jobs.map((item) => item.trackId).join(',')
  )
  check('album cancel key is available', albumGroup?.cancelKey === 'album:a')

  const playlistGroup = byKey.get('playlist:p')
  check('playlist group exists', playlistGroup?.title === 'Playlist P')
  check('shared track stays under its first collection', playlistGroup?.jobs.length === 1)
  check('playlist total uses its ids', playlistGroup?.total === 2, String(playlistGroup?.total))

  const songs = byKey.get('songs')
  check('loose songs get the Songs group', songs?.title === 'Songs')
  check('loose songs have no group cancel', songs?.cancelKey === null)
  check('failed job remains in the group', songs?.state === 'failed')
  check('songs group progress is the active average', songs?.percent === 0)

  const live = groupDownloadJobs(
    data,
    Object.fromEntries(
      data.jobs.map((item) => [
        item.trackId,
        item.trackId === 'b' ? { ...item, percent: 80 } : item
      ])
    )
  )
  check(
    'live progress overrides the snapshot',
    Math.round(live[0]?.percent ?? 0) === 45,
    String(live[0]?.percent)
  )

  check('no jobs means no groups', groupDownloadJobs(snapshot([], [], [])).length === 0)
  check('no snapshot means no groups', groupDownloadJobs(null).length === 0)
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
