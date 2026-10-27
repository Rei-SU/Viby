/**
 * Verifies InnerTube parsing against a real captured response, then exercises the
 * live client. Run with:
 *   npx esbuild tests/innertube.test.ts --bundle --platform=node --format=esm \
 *     --alias:@shared=./src/shared --outfile=/tmp/it.mjs && node /tmp/it.mjs
 */
import { dedupeTracks, extractHeader, extractItems, extractMoodCategories, extractShelves } from '../src/main/innertube/parse'
import { browse, home, moodCategories, search } from '../src/main/innertube/client'
import type { CatalogItem } from '../src/shared/types'

let failures = 0

function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

// ---- mood tiles ------------------------------------------------------------
const moodTiles = extractMoodCategories({
  contents: [
    {
      musicNavigationButtonRenderer: {
        buttonText: { runs: [{ text: 'Focus' }] },
        clickCommand: { browseEndpoint: { params: 'params-focus' } }
      }
    },
    {
      musicNavigationButtonRenderer: {
        buttonText: { simpleText: 'Energize' },
        clickCommand: { browseEndpoint: { params: 'params-energy' } }
      }
    },
    {
      musicNavigationButtonRenderer: {
        buttonText: { runs: [{ text: 'Focus' }] },
        clickCommand: { browseEndpoint: { params: 'duplicate' } }
      }
    },
    {
      musicNavigationButtonRenderer: {
        buttonText: { runs: [{ text: 'No params' }] },
        clickCommand: { browseEndpoint: { browseId: 'x' } }
      }
    }
  ]
})
check(
  'mood tiles keep title and params',
  moodTiles.length === 2 &&
    moodTiles[0]?.title === 'Focus' &&
    moodTiles[0]?.params === 'params-focus' &&
    moodTiles[1]?.title === 'Energize',
  JSON.stringify(moodTiles)
)

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

// Artist pages advertise the complete discography with a "More" browse
// endpoint. The parser must keep it, or the client can never fetch the rest.
const artistShelfResponse = {
  contents: {
    singleColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  {
                    musicCarouselShelfRenderer: {
                      header: {
                        musicCarouselShelfBasicHeaderRenderer: {
                          title: { runs: [{ text: 'Singles & EPs' }] },
                          moreContentButton: {
                            buttonRenderer: {
                              navigationEndpoint: {
                                browseEndpoint: {
                                  browseId: 'MPADUC123',
                                  params: 'ggMIegYIAhoCAQI=',
                                  browseEndpointContextSupportedConfigs: {
                                    browseEndpointContextMusicConfig: {
                                      pageType: 'MUSIC_PAGE_TYPE_ARTIST_DISCOGRAPHY'
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      },
                      contents: [
                        {
                          musicTwoRowItemRenderer: {
                            title: { runs: [{ text: 'Sociopath' }] },
                            subtitle: {
                              runs: [{ text: 'Single' }, { text: ' • ' }, { text: '2022' }]
                            },
                            navigationEndpoint: {
                              browseEndpoint: {
                                browseId: 'MPREb_sociopath',
                                browseEndpointContextSupportedConfigs: {
                                  browseEndpointContextMusicConfig: {
                                    pageType: 'MUSIC_PAGE_TYPE_ALBUM'
                                  }
                                }
                              }
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

const artistShelf = extractShelves(artistShelfResponse)[0]
check(
  'artist shelf keeps its "More" endpoint',
  artistShelf?.more?.browseId === 'MPADUC123' &&
    artistShelf?.more?.params === 'ggMIegYIAhoCAQI=' &&
    artistShelf?.more?.pageType === 'MUSIC_PAGE_TYPE_ARTIST_DISCOGRAPHY',
  JSON.stringify(artistShelf?.more ?? null)
)
check(
  'artist shelf keeps YouTube release labels',
  artistShelf?.items[0]?.releaseType === 'Single',
  artistShelf?.items[0]?.releaseType ?? 'none'
)

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

// A release page can list the same song twice: the audio track and its music
// video. Viby plays the audio, so the duplicate video row is dropped.
function trackRow(id: string, title: string, videoType: CatalogItem['videoType']): CatalogItem {
  return { id, kind: 'song', title, subtitle: '', videoType }
}

const releaseRows: CatalogItem[] = [
  trackRow('audio-sao', 'São Paulo', 'audio'),
  trackRow('video-sao', 'São Paulo', 'video'),
  trackRow('video-official', 'São Paulo (Official Video)', 'video'),
  trackRow('video-live', 'São Paulo (Live From São Paulo)', 'video'),
  trackRow('audio-acapella', 'São Paulo (Single Version / Acapella)', 'audio'),
  trackRow('video-only', 'Only a Video', 'video'),
  trackRow('same-video-id', 'Same ID', 'video'),
  trackRow('same-video-id', 'Same ID (Edit)', 'video')
]
const dedupedRows = dedupeTracks(releaseRows)

check(
  'audio wins over its music video',
  dedupedRows.some((i) => i.id === 'audio-sao') && !dedupedRows.some((i) => i.id === 'video-sao')
)
check('an "(Official Video)" title is the same song', !dedupedRows.some((i) => i.id === 'video-official'))
check('a live version keeps its own row', dedupedRows.some((i) => i.id === 'video-live'))
check('a different audio version keeps its own row', dedupedRows.some((i) => i.id === 'audio-acapella'))
check('a video with no audio twin is kept', dedupedRows.some((i) => i.id === 'video-only'))
check(
  'a repeated video id is kept once',
  dedupedRows.filter((i) => i.id === 'same-video-id').length === 1
)
const releaseCardA: CatalogItem = {
  id: 'MPREb_ep_a',
  browseId: 'MPREb_ep_a',
  kind: 'album',
  title: 'São Paulo',
  subtitle: 'EP'
}
const releaseCardB: CatalogItem = { ...releaseCardA, id: 'MPREb_ep_b', browseId: 'MPREb_ep_b' }
check('release cards are never deduped by title', dedupeTracks([releaseCardA, releaseCardB]).length === 2)

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

// Artist pages preview only ten releases per shelf; the complete discography
// lives behind the shelf's "More" endpoint. Pause's "Sociopath" was missing from
// Viby because only the preview was ever requested.
const pause = await browse('UCD8h4yy9-LIpLqAiWE3iR2g')
const pauseSingles = pause.shelves?.find((shelf) => /singles/i.test(shelf.title))
check(
  'artist page expands to the full discography',
  (pauseSingles?.items.length ?? 0) > 10,
  `${pauseSingles?.items.length ?? 0} releases`
)
check(
  'expanded discography includes Sociopath',
  pauseSingles?.items.some((item) => /^sociopath$/i.test(item.title.trim())) ?? false,
  pauseSingles?.items
    .slice(0, 3)
    .map((item) => item.title)
    .join(' | ') ?? 'no singles shelf'
)

// Discographies longer than 100 releases paginate, and YouTube only accepts
// those continuations from the visitor that received the first page.
const gucci = await browse('UCGJdT8Qip4XObbQZ98Z1CAA')
const gucciAlbums = gucci.shelves?.find((shelf) => /^albums$/i.test(shelf.title))
check(
  'discography follows continuations past 100 releases',
  (gucciAlbums?.items.length ?? 0) > 100,
  `${gucciAlbums?.items.length ?? 0} albums`
)

const liveMoods = await moodCategories()
check(
  'mood categories resolve Focus and Decades',
  liveMoods.some((tile) => tile.title === 'Focus' && tile.params) &&
    liveMoods.some((tile) => tile.title === 'Decades' && tile.params),
  liveMoods.map((tile) => tile.title).join(',')
)
const focusMood = liveMoods.find((tile) => tile.title === 'Focus')
if (focusMood) {
  const page = await browse('FEmusic_moods_and_genres_category', focusMood.params)
  check(
    'a mood page returns playlist shelves',
    (page.shelves?.length ?? 0) > 0 && (page.shelves?.[0]?.items.length ?? 0) > 0,
    `${page.shelves?.length ?? 0} shelves`
  )
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
