/**
 * Verifies InnerTube parsing against a real captured response, then exercises the
 * live client. Run with:
 *   npx esbuild tests/innertube.test.ts --bundle --platform=node --format=esm \
 *     --alias:@shared=./src/shared --outfile=/tmp/it.mjs && node /tmp/it.mjs
 */
import { extractItems, extractShelves } from '../src/main/innertube/parse'
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

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
