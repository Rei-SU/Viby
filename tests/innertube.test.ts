/**
 * Verifies InnerTube parsing against a real captured response, then exercises the
 * live client. Run with:
 *   npx esbuild tests/innertube.test.ts --bundle --platform=node --format=esm \
 *     --alias:@shared=./src/shared --outfile=/tmp/it.mjs && node /tmp/it.mjs
 */
import { extractHeader, extractItems, extractShelves } from '../src/main/innertube/parse'
import { browse, home, search } from '../src/main/innertube/client'
import type { CatalogItem } from '../src/shared/types'

let failures = 0

function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

function show(label: string, items: CatalogItem[], limit = 5): void {
  console.log(`\n${label}: ${items.length} items`)
  for (const item of items.slice(0, limit)) {
    const dur = item.durationSec ? ` ${item.durationSec}s` : ''
    console.log(
      `  ${item.kind.padEnd(8)} ${(item.id || '-').padEnd(14)} ${item.title.slice(0, 40).padEnd(42)} | ${item.subtitle.slice(0, 34)}${dur}`
    )
  }
}

// ---- offline, deterministic -------------------------------------------------
// A minimal captured-shape response. Keeping it inline makes the parser test
// runnable on a clean checkout instead of depending on /tmp/innertube.json.
function songRow(id: string, title: string): unknown {
  return {
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId: id },
      flexColumns: [
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: { runs: [{ text: title }] }
          }
        },
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: { runs: [{ text: 'Daft Punk' }, { text: ' • ' }, { text: '3:30' }] }
          }
        }
      ]
    }
  }
}

const captured = {
  contents: {
    singleColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  {
                    musicShelfRenderer: {
                      contents: [
                        ...Array.from({ length: 11 }, (_, index) =>
                          songRow(`dQw4w9WgX${String(index).padStart(2, '0').slice(-2)}`, `Song ${index + 1}`)
                        ),
                        {
                          musicTwoRowItemRenderer: {
                            title: { runs: [{ text: 'Daft Punk' }] },
                            subtitle: { runs: [{ text: 'Artist' }] },
                            navigationEndpoint: {
                              browseEndpoint: { browseId: 'UC3H0b6Z2r7z2cJc8m6z9Y3w' }
                            }
                          }
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        }
      ]
    }
  }
}

const parsed = extractItems(captured)
show('CAPTURED response', parsed, 8)
console.log('\nchecks:')
check('captured response yields items', parsed.length > 10, `${parsed.length}`)
check(
  'every song has a playable id',
  parsed.filter((i) => i.kind === 'song').every((i) => /^[A-Za-z0-9_-]{11}$/.test(i.id)),
  `${parsed.filter((i) => i.kind === 'song').length} songs`
)
check('captured artists keep a browse id', parsed.some((i) => i.kind === 'artist' && i.browseId))

// Album pages credit the artist in `straplineTextOne`, not the subtitle.
const albumHeader = {
  header: {
    musicResponsiveHeaderRenderer: {
      title: { runs: [{ text: 'KID A MNESIA' }] },
      subtitle: { runs: [{ text: 'Album' }, { text: ' • ' }, { text: '2021' }] },
      straplineTextOne: {
        runs: [
          {
            text: 'Radiohead',
            navigationEndpoint: {
              browseEndpoint: {
                browseId: 'UCr_iyUANcn9OX_yy9piYoLw',
                browseEndpointContextSupportedConfigs: {
                  browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ARTIST' }
                }
              }
            }
          }
        ]
      }
    }
  }
}
const releaseHeader = extractHeader(albumHeader)
check(
  'album header reads the strapline artist',
  releaseHeader?.artist?.name === 'Radiohead' &&
    releaseHeader?.artist?.id === 'UCr_iyUANcn9OX_yy9piYoLw',
  `${releaseHeader?.artist?.name ?? 'none'}`
)
check(
  "album header keeps YouTube's release type",
  releaseHeader?.releaseType === 'Album',
  releaseHeader?.releaseType ?? 'none'
)

// A single must never be shown as an album: the label comes from YouTube, not
// from Viby's internal `kind`.
const singleHeader = {
  header: {
    musicResponsiveHeaderRenderer: {
      title: { runs: [{ text: 'Sociopath' }] },
      subtitle: { runs: [{ text: 'Single' }, { text: ' • ' }, { text: '2022' }] }
    }
  }
}
check(
  'single header is not labelled an album',
  extractHeader(singleHeader)?.releaseType === 'Single',
  extractHeader(singleHeader)?.releaseType ?? 'none'
)

// Search cards carry the same label in their subtitle.
const singleCard = {
  contents: {
    musicTwoRowItemRenderer: {
      title: { runs: [{ text: 'Sociopath' }] },
      subtitle: {
        runs: [
          { text: 'Single' },
          { text: ' • ' },
          { text: 'razudaisu' },
          { text: ' • ' },
          { text: '2022' }
        ]
      },
      navigationEndpoint: {
        browseEndpoint: {
          browseId: 'MPREb_single',
          browseEndpointContextSupportedConfigs: {
            browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ALBUM' }
          }
        }
      }
    }
  }
}
const singleCardItem = extractItems(singleCard)[0]
check(
  'release cards keep the release type',
  singleCardItem?.kind === 'album' && singleCardItem?.releaseType === 'Single',
  `${singleCardItem?.kind ?? 'none'} / ${singleCardItem?.releaseType ?? 'none'}`
)

// A playlist strapline is the owner, so it must never become the track artist.
const playlistHeader = {
  header: {
    musicResponsiveHeaderRenderer: {
      title: { runs: [{ text: 'Focus' }] },
      subtitle: { runs: [{ text: 'Playlist' }, { text: ' • ' }, { text: '2024' }] },
      straplineTextOne: {
        runs: [
          {
            text: 'Some Listener',
            navigationEndpoint: { browseEndpoint: { browseId: 'UCsomeone' } }
          }
        ]
      }
    }
  }
}
check('playlist owner strapline is not an artist', extractHeader(playlistHeader)?.artist === undefined)
check(
  'playlist headers carry no release type',
  extractHeader(playlistHeader)?.releaseType === undefined,
  extractHeader(playlistHeader)?.releaseType ?? 'none'
)

// ---- live -------------------------------------------------------------------
const songs = await search('daft punk', 'songs')
show('\nLIVE search (songs filter)', songs)
check('songs filter returns only songs', songs.every((i) => i.kind === 'song'))
check('songs filter returns playable ids', songs.every((i) => i.id.length === 11))

const homeShelves = await home()
console.log(`\nLIVE home: ${homeShelves.length} shelves`)
for (const shelf of homeShelves.slice(0, 6)) {
  console.log(`  "${shelf.title}" — ${shelf.items.length} items, first: ${shelf.items[0]?.title.slice(0, 34)}`)
}
check('home returns shelves', homeShelves.length > 0)
check(
  'shelves are titled',
  homeShelves.filter((s) => s.title.trim()).length >= Math.max(1, homeShelves.length - 2)
)

// Album/playlist pages reuse the same parser, so open a search result.
const playlists = await search('daft punk', 'playlists')
const playlist = playlists.find((i) => i.kind === 'playlist' && i.browseId)
if (playlist) {
  const { items: tracks } = await browse(playlist.browseId!)
  show(`\nLIVE browse playlist "${playlist.title.slice(0, 30)}"`, tracks)
  check('browse returns tracks', tracks.length > 3, `${tracks.length}`)
} else {
  check('found a playlist to browse', false, 'none in search')
}

// Album pages are the case that regressed: the header artist lives in the
// strapline, and rows carry no artist of their own.
const albums = await search('kid a mnesia', 'albums')
const album = albums.find((i) => i.kind === 'album' && i.browseId)
if (album) {
  const page = await browse(album.browseId!)
  check(
    'live album header knows its artist',
    Boolean(page.header?.artist?.name),
    `${page.header?.artist?.name ?? 'none'} — "${page.header?.subtitle ?? ''}"`
  )
} else {
  check('found an album to browse', false, 'none in search')
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
