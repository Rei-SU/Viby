/**
 * Catalog behaviour checks: every search filter, and every kind of detail page.
 *
 *   npx esbuild tests/catalog.test.ts --bundle --platform=node --format=esm \
 *     --alias:@shared=./src/shared --outfile=/tmp/catalog.mjs && node /tmp/catalog.mjs
 */
import { audioTrackFor, browse, charts, home, radio, search } from '../src/main/innertube/client'
import type { CatalogItem, SearchFilterName } from '../src/shared/types'

let failures = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

function kinds(items: CatalogItem[]): string {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1)
  return [...counts].map(([k, n]) => `${k}=${n}`).join(', ')
}

const filters: SearchFilterName[] = ['all', 'songs', 'albums', 'artists', 'playlists']

console.log('search filters:')
const byFilter = new Map<SearchFilterName, CatalogItem[]>()

for (const filter of filters) {
  const items = await search('daft punk', filter)
  byFilter.set(filter, items)
  console.log(`\n  [${filter}] ${items.length} items — ${kinds(items)}`)
  for (const item of items.slice(0, 3)) {
    console.log(`    ${item.kind.padEnd(8)} id=${(item.id || '-').padEnd(14)} ${item.title.slice(0, 40)}`)
  }
  check(`[${filter}] returns results`, items.length > 0)
  check(`[${filter}] every item has a title`, items.every((i) => i.title.length > 0))
  check(`[${filter}] every song is playable`, items.filter((i) => i.kind === 'song').every((i) => i.id.length === 11))

  const expected =
    filter === 'songs'
      ? 'song'
      : filter === 'albums'
        ? 'album'
        : filter === 'artists'
          ? 'artist'
          : 'playlist'
  if (filter !== 'all') {
    const matching = items.filter((i) => i.kind === expected).length
    check(`[${filter}] mostly ${expected} items`, matching >= items.length * 0.6, `${matching}/${items.length}`)
  }

  if (filter === 'all') {
    const unknown = items.filter((i) => i.kind === 'unknown')
    if (unknown.length > 0) {
      console.log('    unknown items:')
      for (const item of unknown) {
        console.log(
          `      id="${item.id}" browseId="${item.browseId ?? ''}" | ${item.title.slice(0, 34)} | ${item.subtitle.slice(0, 34)}`
        )
      }
      check(
        'every unknown item is at least openable',
        unknown.every((i) => Boolean(i.browseId)),
        `${unknown.filter((i) => !i.browseId).length} with no target`
      )
    }
  }
}

console.log('\nranking and links:')
const mixed = byFilter.get('all') ?? []
const kindRank = mixed.map((i) => (i.kind === 'song' ? 0 : 1))
check(
  'songs rank first in mixed results',
  kindRank.every((value, i) => i === 0 || kindRank[i - 1] <= value),
  `${mixed.filter((i) => i.kind === 'song').length}/${mixed.length} songs`
)

const ranked = byFilter.get('songs') ?? []
check(
  'song rows carry artist ids for linking',
  ranked.every((i) => Boolean(i.parts?.some((part) => part.artistId))),
  `${ranked.filter((i) => i.parts?.some((p) => p.artistId)).length}/${ranked.length}`
)

console.log('\nradio (autoplay):')
const radioItems = await radio('dQw4w9WgXcQ')
console.log(`  ${radioItems.length} related tracks — ${kinds(radioItems)}`)
for (const item of radioItems.slice(0, 5)) {
  console.log(`    ${item.id} ${item.title.slice(0, 38)} | ${item.subtitle.slice(0, 34)}`)
}
check('radio returns a queue of related tracks', radioItems.length > 10, `${radioItems.length}`)
check('radio items are playable songs', radioItems.every((i) => i.kind === 'song' && i.id.length === 11))
check('radio items carry artists and durations', radioItems.every((i) => (i.artists?.length ?? 0) > 0 && (i.durationSec ?? 0) > 0))
check('radio excludes the seed track', radioItems.every((i) => i.id !== 'dQw4w9WgXcQ'))
check(
  'radio items carry artist ids for linking',
  radioItems.every((i) => i.parts?.some((part) => part.artistId)),
  `${radioItems.filter((i) => i.parts?.some((p) => p.artistId)).length}/${radioItems.length}`
)

console.log('\naudio-first:')
const videoSearch = await search('footloose official video', 'all')
const video =
  videoSearch.find((i) => i.videoType === 'video') ??
  videoSearch.find((i) => i.videoType === 'ugc')
if (video) {
  const alt = await audioTrackFor(video.id, video.title, video.artists?.[0] ?? '')
  console.log(`  video: "${video.title.slice(0, 40)}" (${video.videoType})`)
  console.log(`  audio: "${alt?.title.slice(0, 40) ?? '(none)'}" (${alt?.videoType ?? '-'})`)
  check('music video maps to the released audio track', alt?.videoType === 'audio', alt?.id ?? 'no match')
} else {
  check('found a video item in search', false)
}
check(
  'radio excludes video uploads',
  radioItems.every((item) => !/\((official\s+)?(music\s+)?video\)/i.test(item.title)),
  `${radioItems.length} tracks`
)
check(
  'search ranks official audio first',
  (await search('daft punk', 'songs')).slice(0, 3).every((item) => item.videoType === 'audio')
)

console.log('\nhome music:')
const homeSongs = (await home()).flatMap((s) => s.items).filter((i) => i.kind === 'song')
check(
  'home songs carry artist ids for linking',
  homeSongs.length > 0 && homeSongs.every((i) => i.parts?.some((part) => part.artistId)),
  `${homeSongs.filter((i) => i.parts?.some((p) => p.artistId)).length}/${homeSongs.length}`
)

console.log('\ndetail pages:')
const albumCandidates = (byFilter.get('albums') ?? []).filter((i) => i.kind === 'album' && i.browseId).slice(0, 4)
if (albumCandidates.length > 0) {
  // Search returns singles too, so only require that an album opens and exposes
  // playable tracks. The full-track-list check runs against an album reached from
  // an artist page, where the release is unambiguous.
  const firstAlbum = albumCandidates[0]
  const albumPage = await browse(firstAlbum.browseId!)
  const tracks = albumPage.items
  console.log(`\n  album "${firstAlbum.title.slice(0, 30)}": ${tracks.length} items — ${kinds(tracks)}`)
  check('album page gives playable tracks', tracks.some((t) => t.kind === 'song' && t.id.length === 11))
  check('album page has its own header art', Boolean(albumPage.header?.thumbnail), `title="${albumPage.header?.title ?? ''}"`)
  check('album tracks have durations', tracks.some((t) => (t.durationSec ?? 0) > 0))
} else {
  check('found an album to open', false)
}

const artist = byFilter.get('artists')?.find((i) => i.kind === 'artist' && i.browseId)
if (artist) {
  const artistPage = await browse(artist.browseId!)
  const items = artistPage.items
  console.log(`\n  artist "${artist.title.slice(0, 30)}": ${items.length} items — ${kinds(items)}`)
  check('artist page gives playable songs', items.filter((t) => t.kind === 'song' && t.id.length === 11).length > 0)
  check(
    'artist page has its own header art',
    Boolean(artistPage.header?.thumbnail) && artistPage.header?.title === artist.title,
    `title="${artistPage.header?.title ?? ''}" art=${artistPage.header?.thumbnail ? 'yes' : 'no'}`
  )


  const shelfTitles = (artistPage.shelves ?? []).map((shelf) => shelf.title)
  console.log(`    shelves: ${shelfTitles.join(' | ')}`)
  check('artist page has a discshelf of albums', shelfTitles.some((t) => /^albums$/i.test(t)), shelfTitles.join(', '))
  check(
    'artist page has singles & EPs',
    shelfTitles.some((t) => /singles/i.test(t)),
    shelfTitles.join(', ')
  )
  check(
    'album shelves contain albums, not songs',
    (artistPage.shelves ?? [])
      .filter((shelf) => /albums|singles/i.test(shelf.title))
      .every((shelf) => shelf.items.every((entry) => entry.kind === 'album'))
  )

  const knownArtist = await browse('UCRr1xG_2WIDs18a6cIiCxeA')
  check(
    'known artist page exposes monthly listeners',
    /^\d+(?:\.\d+)?[KMB]?$/.test(knownArtist.header?.monthlyListeners ?? ''),
    knownArtist.header?.monthlyListeners ?? 'missing'
  )

  const topSong = (artistPage.shelves ?? []).find((shelf) => /top songs/i.test(shelf.title))?.items[0]
  check('top songs carry play counts', Boolean(topSong?.views), topSong?.views ?? '(none)')
  check(
    'top songs carry a clickable album',
    Boolean(topSong?.parts?.some((part) => part.albumId)),
    topSong?.parts?.map((p) => p.text).join('') ?? ''
  )
  check(
    'artist page has no unlabelled items',
    items.every((i) => i.kind !== 'unknown'),
    `${items.filter((i) => i.kind === 'unknown').length} unknown`
  )

  // An album reached from an artist page is a real release, not a search typo.
  const artistAlbum = items.find((i) => i.kind === 'album' && i.browseId)
  if (artistAlbum) {
    const { items: albumTracks } = await browse(artistAlbum.browseId!)
    const playable = albumTracks.filter((t) => t.kind === 'song' && t.id.length === 11)
    console.log(`\n  album from artist "${artistAlbum.title.slice(0, 26)}": ${playable.length} playable tracks`)
    check('an album page exposes its full track list', playable.length > 5, `${playable.length} tracks`)
  } else {
    check('found an album on the artist page', false)
  }
} else {
  check('found an artist to open', false)
}

const playlist = byFilter.get('playlists')?.find((i) => i.kind === 'playlist' && i.browseId)
if (playlist) {
  const { items } = await browse(playlist.browseId!)
  console.log(`\n  playlist "${playlist.title.slice(0, 30)}": ${items.length} items — ${kinds(items)}`)
  check('playlist page gives playable tracks', items.filter((t) => t.kind === 'song').length > 0)
} else {
  check('found a playlist to open', false)
}

// Charts is the other entry point, and its items are mostly artists.
const chartItems = (await charts()).flatMap((s) => s.items)
console.log(`\n  charts: ${chartItems.length} items — ${kinds(chartItems)}`)
check('charts returns items', chartItems.length > 0)
const chartArtist = chartItems.find((i) => i.kind === 'artist' && i.browseId)
if (chartArtist) {
  const { items } = await browse(chartArtist.browseId!)
  check(
    'chart artist page gives playable songs',
    items.some((t) => t.kind === 'song' && t.id.length === 11),
    `${items.length} items — ${kinds(items)}`
  )
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
