import { historyItem, summarizeHistory } from '../src/shared/listening'
import type { HistoryEntry } from '../src/shared/types'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}

const NOW = Date.parse('2026-10-26T12:00:00Z')
const WEEK = 7 * 24 * 60 * 60 * 1000
const history: HistoryEntry[] = [
  {
    trackId: 'a',
    title: 'A',
    artist: 'Alpha',
    artistId: 'alpha-id',
    album: 'One',
    albumId: 'one-id',
    durationSec: 200,
    playedAt: NOW - 1000,
    completion: 0.5,
    thumbnail: 'one-a'
  },
  {
    trackId: 'b',
    title: 'B',
    artist: 'Alpha',
    artistId: 'alpha-id',
    album: 'One',
    albumId: 'one-id',
    durationSec: 200,
    playedAt: NOW - 2000,
    completion: 1,
    thumbnail: 'one-b'
  },
  {
    trackId: 'a',
    title: 'A',
    artist: 'Alpha',
    artistId: 'alpha-id',
    album: 'One',
    albumId: 'one-id',
    durationSec: 200,
    playedAt: NOW - 3000,
    completion: 1,
    thumbnail: 'one-a'
  },
  {
    trackId: 'c',
    title: 'C',
    artist: 'Beta',
    album: 'Two',
    albumId: 'two-id',
    durationSec: 300,
    playedAt: NOW - 4000,
    completion: 1,
    thumbnail: 'two-c'
  },
  {
    trackId: 'd',
    title: 'D',
    artist: 'Beta',
    durationSec: 100,
    playedAt: NOW - 5000,
    completion: 1,
    thumbnail: 'beta-d'
  },
  {
    trackId: 'old',
    title: 'Old',
    artist: 'Old Artist',
    durationSec: 1000,
    playedAt: NOW - WEEK - 1000,
    completion: 1
  }
]

const summary = summarizeHistory(history, NOW - WEEK)
check('summary filters to the last seven days', summary.plays === 5 && summary.uniqueTracks === 4, JSON.stringify(summary))
check('listening time uses duration and completion', summary.totalSeconds === 900, `${summary.totalSeconds}s`)
check('artist totals and ordering are correct', summary.artists[0]?.name === 'Alpha' && summary.artists[0]?.seconds === 500, JSON.stringify(summary.artists))
check('artist song counts are unique', summary.artists[0]?.tracks === 2, `${summary.artists[0]?.tracks}`)
check('play counts include repeats', summary.artists[0]?.plays === 3, `${summary.artists[0]?.plays}`)
check('latest play timestamp is retained', summary.artists[0]?.lastPlayed === NOW - 1000, `${summary.artists[0]?.lastPlayed}`)
check(
  'daily buckets preserve the weekly total',
  summary.days.length === 7 &&
    summary.days.reduce((sum, day) => sum + day.seconds, 0) === summary.totalSeconds &&
    summary.days.reduce((sum, day) => sum + day.plays, 0) === summary.plays,
  JSON.stringify(summary.days)
)

const collaboration = summarizeHistory(
  [history[0], { ...history[0], artist: 'Alpha, Guest', artistId: 'collab-id' }],
  NOW - WEEK
)
check(
  'collaborations roll into the primary artist',
  collaboration.artists.length === 1 && collaboration.artists[0]?.name === 'Alpha' && collaboration.artists[0]?.artistId === 'alpha-id',
  JSON.stringify(collaboration.artists)
)

// ---- history rows ---------------------------------------------------------
const row = historyItem(history[0])
check('a history row keeps the artwork and duration', row.id === 'a' && row.thumbnail === 'one-a' && row.durationSec === 200, JSON.stringify(row))
check('the row subtitle shows artist and release', row.subtitle === 'Alpha · One', String(row.subtitle))
check(
  'the artist credit is linked',
  row.parts?.filter((part) => part.entity === 'artist').map((part) => part.text).join('|') === 'Alpha',
  JSON.stringify(row.parts)
)
check(
  'the release stays a link',
  row.parts?.some((part) => part.albumId === 'one-id' && part.entity === 'album') === true,
  JSON.stringify(row.parts)
)

const legacy = historyItem({ ...history[0], artist: 'Stormy, Manal', artistId: undefined, artistParts: undefined })
check(
  'legacy combined credits are split for linking',
  legacy.parts?.filter((part) => part.entity === 'artist').map((part) => part.text).join('|') === 'Stormy|Manal',
  JSON.stringify(legacy.parts)
)

const featuredHistory: HistoryEntry[] = [
  {
    trackId: 'f',
    title: 'Sata 9ttala',
    artist: 'Stormy, Manal',
    artistId: 'stormy-id',
    artistParts: [
      { text: 'Stormy', artistId: 'stormy-id', entity: 'artist' },
      { text: ', ' },
      { text: 'Manal', artistId: 'manal-id', entity: 'artist' }
    ],
    playedAt: NOW - 500,
    completion: 0.8
  }
]
const featured = historyItem(featuredHistory[0])
check(
  'known featured artists keep their own ids',
  featured.parts?.filter((part) => part.entity === 'artist').map((part) => part.artistId).join('|') ===
    'stormy-id|manal-id',
  JSON.stringify(featured.parts)
)
check(
  'top artists use the primary credit',
  summarizeHistory(featuredHistory, NOW - WEEK).artists[0]?.name === 'Stormy',
  JSON.stringify(summarizeHistory(featuredHistory, NOW - WEEK).artists)
)

const namedRelease = historyItem({
  trackId: 'x',
  title: 'X',
  artist: 'A',
  album: 'Home',
  playedAt: NOW,
  completion: 0
})
check(
  'an old entry with only a release name still offers the album link',
  namedRelease.parts?.some((part) => part.entity === 'album' && !part.albumId) === true,
  JSON.stringify(namedRelease.parts)
)

const unknown = historyItem({
  trackId: 'u',
  title: 'U',
  artist: 'Unknown artist',
  playedAt: NOW,
  completion: 0
})
check('unknown artists render no credit links', unknown.parts === undefined, JSON.stringify(unknown.parts))

const noDurations = history.map((entry) => ({ ...entry, durationSec: undefined }))
const withoutTime = summarizeHistory(noDurations, NOW - WEEK)
check('missing durations never fabricate listening time', withoutTime.totalSeconds === 0 && withoutTime.plays === 5, JSON.stringify(withoutTime))
check('play counts still rank artists without durations', withoutTime.artists[0]?.name === 'Alpha' && withoutTime.artists[0]?.plays === 3, JSON.stringify(withoutTime.artists))

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('\nlistening: all checks passed')
