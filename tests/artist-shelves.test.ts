/**
 * Shows the shelf structure of an artist page so the UI can render a real
 * discography. Run:
 *   npx esbuild tests/artist-shelves.test.ts --bundle --platform=node --format=esm \
 *     --alias:@shared=./src/shared --outfile=/tmp/artist.mjs && node /tmp/artist.mjs
 */
import { browse } from '../src/main/innertube/client'

const id = process.argv[2] ?? 'UCRr1xG_2WIDs18a6cIiCxeA'
const page = await browse(id)

console.log(`header: ${page.header?.title ?? '(none)'} — art: ${page.header?.thumbnail ? 'yes' : 'no'}`)
console.log(`items: ${page.items.length}`)
console.log(`shelves: ${page.shelves?.length ?? 0}`)

for (const shelf of page.shelves ?? []) {
  const kinds = new Map<string, number>()
  for (const item of shelf.items) kinds.set(item.kind, (kinds.get(item.kind) ?? 0) + 1)
  console.log(
    `\n  "${shelf.title}" — ${shelf.items.length} items (${[...kinds].map(([k, n]) => `${k}=${n}`).join(', ')})`
  )
  for (const item of shelf.items.slice(0, 3)) {
    console.log(`    [${item.kind}] ${item.title.slice(0, 44)} | ${item.subtitle.slice(0, 36)}`)
  }
}
