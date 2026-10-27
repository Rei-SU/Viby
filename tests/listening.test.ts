import { albumMatch, groupRecentHistory, summarizeHistory } from '../src/shared/listening'
import type { CatalogItem, HistoryEntry } from '../src/shared/types'

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

const recent = groupRecentHistory(history, 2, 3)
check('recent releases are grouped by album', recent.length === 2 && recent[0]?.title === 'One' && recent[1]?.title === 'Two', JSON.stringify(recent.map((g) => g.title)))
check('duplicate tracks do not repeat artwork or rows', recent[0]?.tracks.map((t) => t.id).join(',') === 'a,b', recent[0]?.tracks.map((t) => t.id).join(','))
check('recent groups keep navigation metadata', recent[0]?.albumId === 'one-id' && recent[0]?.artistId === 'alpha-id', JSON.stringify(recent[0]))

const fallback = groupRecentHistory(history, 4, 3)
check('missing albums fall back to artist grouping', fallback[2]?.key === 'artist:beta' && fallback[2]?.title === 'Beta', JSON.stringify(fallback[2]))

check(
  'recent groups keep the release on replay',
  recent[0]?.tracks[0]?.parts?.some((part) => part.albumId === 'one-id' && part.entity === 'album') === true,
  JSON.stringify(recent[0]?.tracks[0]?.parts)
)

// A featured credit must survive the round trip through history, or replaying
// the row collapses back to one artist in the player.
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
const featuredItem = groupRecentHistory(featuredHistory)[0]?.tracks[0]
const featuredArtists = featuredItem?.parts?.filter((part) => part.entity === 'artist') ?? []
check(
  'recent items keep every featured artist',
  featuredArtists.length === 2 && featuredArtists[1]?.artistId === 'manal-id',
  JSON.stringify(featuredItem?.parts)
)
check('the credit separator survives', featuredItem?.parts?.[1]?.text === ', ')
check(
  'top artists use the primary credit',
  summarizeHistory(featuredHistory, NOW - WEEK).artists[0]?.name === 'Stormy',
  JSON.stringify(summarizeHistory(featuredHistory, NOW - WEEK).artists)
)

const legacyItem = groupRecentHistory([
  {
    trackId: 'g',
    title: 'Legacy',
    artist: 'Stormy, Manal',
    playedAt: NOW - 400,
    completion: 0
  }
])[0]?.tracks[0]
check(
  'legacy combined credits are split for linking',
  (legacyItem?.parts?.filter((part) => part.entity === 'artist').length ?? 0) === 2,
  JSON.stringify(legacyItem?.parts)
)

// Two releases can share a name ("Sociopath" has twenty on YouTube Music). They
// must not merge, and a click must not open the other artist's release.
const sameTitle = groupRecentHistory(
  [
    {
      trackId: 'x',
      title: 'X',
      artist: 'Alpha',
      artistId: 'alpha-id',
      album: 'Sociopath',
      playedAt: NOW,
      completion: 1
    },
    {
      trackId: 'y',
      title: 'Y',
      artist: 'Beta',
      artistId: 'beta-id',
      album: 'Sociopath',
      playedAt: NOW - 1000,
      completion: 1
    }
  ],
  4,
  2
)
check(
  'same-named releases by different artists stay separate',
  sameTitle.length === 2 && sameTitle[0]?.tracks[0]?.id === 'x' && sameTitle[1]?.tracks[0]?.id === 'y',
  JSON.stringify(sameTitle.map((group) => group.key))
)

const sociopathGroup = {
  key: 'album:sociopath|pause-id',
  title: 'Sociopath',
  artist: 'Pause',
  artistId: 'pause-id',
  tracks: []
}
const release = (id: string, artists: string[]): CatalogItem => ({
  id,
  browseId: id,
  kind: 'album',
  title: 'Sociopath',
  subtitle: '',
  artists
})
check(
  'release matching requires the credited artist',
  albumMatch([release('stranger', ['razudaisu']), release('right', ['Pause'])], sociopathGroup)?.id === 'right',
  'picked the release credited to Pause'
)
check(
  'a same-named release by another artist is never opened',
  albumMatch([release('stranger', ['razudaisu'])], sociopathGroup) === null,
  'no title-only fallback'
)
check(
  'a one-word artist does not match a longer name',
  albumMatch([release('other', ['Pause flow'])], sociopathGroup) === null,
  'Pause != Pause flow'
)
check(
  'a multi-word artist matches a collaboration credit',
  albumMatch([release('collab', ['Yung Vision', 'Young Lime'])], { ...sociopathGroup, artist: 'Yung Vision' })
    ?.id === 'collab',
  'Yung Vision on a joint release'
)

const noDurations = history.map((entry) => ({ ...entry, durationSec: undefined }))
const withoutTime = summarizeHistory(noDurations, NOW - WEEK)
check('missing durations never fabricate listening time', withoutTime.totalSeconds === 0 && withoutTime.plays === 5, JSON.stringify(withoutTime))
check('play counts still rank artists without durations', withoutTime.artists[0]?.name === 'Alpha' && withoutTime.artists[0]?.plays === 3, JSON.stringify(withoutTime.artists))

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
