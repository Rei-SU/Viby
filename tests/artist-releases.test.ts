/**
 * Artist discography grouping. Run: node tests/unit.mjs artist-releases
 */
import { artistReleaseGroups } from '../src/renderer/lib/artist-releases'
import type { CatalogItem, Shelf } from '../src/shared/types'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const release = (id: string, title: string, subtitle: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  browseId: id,
  kind: 'album',
  title,
  subtitle: '',
  ...extra,
  ...(subtitle ? { subtitle } : {})
})

const albums: Shelf = {
  title: 'Albums',
  items: [
    release('a2024', 'Newest', 'Album • 2024'),
    release('a2021', 'Older', 'Album • 2021'),
    release('a-noyear', 'Undated', ''),
    release('a2022', 'Middle', '2022')
  ]
}
const singles: Shelf = {
  title: 'Singles & EPs',
  items: [
    release('s2025', 'Fresh Single', 'Single • 2025'),
    release('s2020', 'Old EP', 'EP • 2020'),
    release('a2024', 'Newest', 'Album • 2024')
  ]
}

const groups = artistReleaseGroups([albums, singles])

console.log('release captions and kinds:')
const middle = groups.albums.find((r) => r.item.id === 'a2022')
check('a year-only caption gains its release kind', middle?.item.subtitle === 'Album • 2022')
check('the inferred kind is exposed', middle?.kind === 'Album')
check('the year is parsed', middle?.year === 2022)
const undated = groups.albums.find((r) => r.item.id === 'a-noyear')
check('a missing year keeps the kind caption', undated?.item.subtitle === 'Album')
check('a missing year stays undefined', undated?.year === undefined)
check(
  'a single keeps its own label',
  groups.singles.find((r) => r.item.id === 's2025')?.item.subtitle === 'Single • 2025'
)

console.log('\npopular releases:')
check('the mixed row caps at six', groups.popular.length === 6, String(groups.popular.length))
check(
  'albums and singles alternate',
  groups.popular.slice(0, 4).map((r) => r.item.id).join(',') === 'a2024,s2025,a2021,s2020',
  groups.popular.map((r) => r.item.id).join(',')
)
check('the row has no duplicate releases', new Set(groups.popular.map((r) => r.item.id)).size === groups.popular.length)

console.log('\nall releases:')
check('duplicates across shelves are dropped', groups.all.length === 6, String(groups.all.length))
check(
  'newest comes first',
  groups.all.map((r) => r.item.id).join(',') === 's2025,a2024,a2022,a2021,s2020,a-noyear',
  groups.all.map((r) => r.item.id).join(',')
)
check('an undated release sinks to the end', groups.all[groups.all.length - 1]?.item.id === 'a-noyear')

console.log('\nmissing shelves:')
const empty = artistReleaseGroups([])
check('no shelves produce empty groups', empty.all.length === 0 && empty.popular.length === 0)
const onlyAlbums = artistReleaseGroups([albums])
check('a missing singles shelf is fine', onlyAlbums.singles.length === 0 && onlyAlbums.albums.length === 4)

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
