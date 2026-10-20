/**
 * Thumbnail diagnostics: which items get a thumbnail, and whether the URLs the
 * parser produces actually return images from the CDN.
 *
 *   npx esbuild tests/thumbs.test.ts --bundle --platform=node --format=esm \
 *     --alias:@shared=./src/shared --outfile=/tmp/thumbs.mjs && node /tmp/thumbs.mjs
 */
import { browse, charts, home, search } from '../src/main/innertube/client'
import type { CatalogItem } from '../src/shared/types'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function probe(label: string, url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    const type = res.headers.get('content-type') ?? '?'
    const len = res.headers.get('content-length') ?? '?'
    await res.body?.cancel()
    return `${label.padEnd(18)} ${String(res.status).padEnd(4)} ${type.padEnd(12)} ${String(len).padStart(7)}b`
  } catch (err) {
    return `${label.padEnd(18)} ERR  ${err instanceof Error ? err.message : String(err)}`
  }
}

const songs = await search('daft punk', 'songs')
const homeShelves = await home()
const homeItems = homeShelves.flatMap((s) => s.items)

function report(name: string, items: CatalogItem[]): void {
  const withThumb = items.filter((i) => i.thumbnail)
  console.log(
    `\n${name}: ${items.length} items, ${withThumb.length} with a thumbnail, ${items.length - withThumb.length} without`
  )
  const kinds = new Map<string, number>()
  for (const item of items) {
    const key = `${item.kind}${item.thumbnail ? '+thumb' : ' NO-THUMB'}`
    kinds.set(key, (kinds.get(key) ?? 0) + 1)
  }
  console.log('  breakdown:', [...kinds].map(([k, v]) => `${k}=${v}`).join(', '))

  const missing = items.filter((i) => !i.thumbnail).slice(0, 3)
  for (const item of missing) {
    console.log(`  missing: [${item.kind}] "${item.title.slice(0, 40)}" — ${item.subtitle.slice(0, 30)}`)
  }
}

report('SEARCH songs', songs)
report('HOME', homeItems)

const chartItems = (await charts()).flatMap((s) => s.items)
report('CHARTS', chartItems)

const playlist = [...homeItems, ...chartItems].find((i) => i.kind === 'playlist' && i.browseId)
if (playlist) {
  const { items: tracks } = await browse(playlist.browseId!)
  report(`BROWSE "${playlist.title.slice(0, 24)}"`, tracks)
  console.log(`  parent art present: ${Boolean(playlist.thumbnail)}`)
}

const samples = [...songs, ...homeItems].filter((i) => i.thumbnail).slice(0, 5)
console.log('\nURL probes (as parsed / as YouTube sent / size-stripped):')
for (const item of samples) {
  const parsed = item.thumbnail!
  const stripped = parsed.replace(/=[^/]*$/, '')
  const original = parsed.replace(/=w\d+-h\d+/, '=w120-h120')
  console.log(`\n  "${item.title.slice(0, 34)}"`)
  console.log('   ', parsed.replace(/^https:\/\/[^/]+/, ''))
  console.log('   ', await probe('as parsed', parsed))
  console.log('   ', await probe('as YouTube sent', original))
  console.log('   ', await probe('stripped', stripped))
}
