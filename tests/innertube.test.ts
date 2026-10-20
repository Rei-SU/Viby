/**
 * Verifies InnerTube parsing against a real captured response, then exercises the
 * live client. Run with:
 *   npx esbuild tests/innertube.test.ts --bundle --platform=node --format=esm \
 *     --alias:@shared=./src/shared --outfile=/tmp/it.mjs && node /tmp/it.mjs
 */
import { readFileSync } from 'node:fs'
import { extractItems, extractShelves } from '../src/main/innertube/parse'
import { browse, charts, home, search } from '../src/main/innertube/client'
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
const captured = JSON.parse(readFileSync('/tmp/innertube.json', 'utf8'))
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

const chartShelves = await charts()
console.log(`\nLIVE charts: ${chartShelves.length} shelves`)
for (const shelf of chartShelves.slice(0, 4)) {
  console.log(`  "${shelf.title}" — ${shelf.items.length} items`)
}

// Album/playlist pages reuse the same parser, so open whatever charts gave us.
const playlist = chartShelves.flatMap((s) => s.items).find((i) => i.kind === 'playlist' && i.browseId)
if (playlist) {
  const { items: tracks } = await browse(playlist.browseId!)
  show(`\nLIVE browse playlist "${playlist.title.slice(0, 30)}"`, tracks)
  check('browse returns tracks', tracks.length > 3, `${tracks.length}`)
} else {
  check('found a playlist to browse', false, 'none in charts')
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
