/**
 * Artist Play all queue tail. Run: node tests/unit.mjs artist-queue
 */
import { createArtistQueue } from '../src/renderer/lib/artist-queue'
import type { ArtistRelease } from '../src/renderer/lib/artist-releases'
import type { BrowseHeader, CatalogItem } from '../src/shared/types'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const song = (id: string, title: string, artists?: string[], durationSec?: number): CatalogItem => ({
  id,
  kind: 'song',
  title,
  subtitle: artists?.join(', ') ?? '',
  artists,
  durationSec
})

const loaded = (items: CatalogItem[], header?: BrowseHeader) => ({ items, header })

const release = (id: string, year: number): ArtistRelease => ({
  kind: 'Album',
  year,
  item: {
    id,
    browseId: id,
    kind: 'album',
    title: `Release ${id}`,
    subtitle: `Album • ${year}`,
    releaseType: 'Album'
  }
})

console.log('release order and popular dedupe:')
{
  const calls: string[] = []
  const tracks: Record<string, CatalogItem[]> = {
    r1: [
      song('p1', 'Song (feat. X)', ['Artist']),
      song('s1', 'Song', ['Artist']),
      song('a1', 'First', ['Artist']),
      song('a2', 'Second', ['Artist']),
      song('a3', 'Third', ['Artist']),
      song('a4', 'Fourth', ['Artist']),
      song('a5', 'Fifth', ['Artist'])
    ],
    r2: [song('b1', 'Older', ['Artist'])]
  }
  const queue = createArtistQueue({
    artist: { name: 'Artist', id: 'UCartist' },
    releases: [release('r1', 2024), release('r2', 2023)],
    popular: [song('p1', 'Song (feat. X)', ['Artist'])],
    loadRelease: async (id) => {
      calls.push(id)
      return tracks[id] ? loaded(tracks[id]) : null
    },
    isOffline: () => false
  })

  check('the tail reports more work', queue.hasMore() === true)
  const first = (await queue.next()) ?? []
  check('releases load in the supplied newest-first order', calls.join(',') === 'r1', calls.join(','))
  check('the popular id is not repeated', !first.some((item) => item.id === 'p1'))
  check('a same-titled album row is not repeated', !first.some((item) => item.id === 's1'))
  check('the first batch has the album tracks', first.map((item) => item.id).join(',') === 'a1,a2,a3,a4,a5', first.map((item) => item.id).join(','))
  const second = (await queue.next()) ?? []
  check('the next release follows', second.map((item) => item.id).join(',') === 'b1')
  check('the tail is exhausted', (await queue.next()) === null)
  check('hasMore is false at the end', queue.hasMore() === false)
  check('an exhausted tail persists nothing', queue.persist() === null)
}

console.log('\npending releases persist across a restart:')
{
  const queue = createArtistQueue({
    artist: { name: 'Artist', id: 'UCartist' },
    releases: [release('r1', 2024), release('r2', 2023)],
    popular: [],
    loadRelease: async (id) =>
      loaded(
        id === 'r1'
          ? [1, 2, 3, 4, 5].map((n) => song(`r1-${n}`, `R1 track ${n}`, ['Artist']))
          : [song('r2-track', 'R2 track', ['Artist'])]
      ),
    isOffline: () => false
  })
  check(
    'the whole release list is saved before loading',
    queue.persist()?.releaseIds.join(',') === 'r1,r2',
    JSON.stringify(queue.persist())
  )
  await queue.next()
  check('a loaded release leaves the saved tail', queue.persist()?.releaseIds.join(',') === 'r2')
  check('the artist identity is saved', queue.persist()?.artist.id === 'UCartist')
}

console.log('\nsame titles with different durations:')
{
  const queue = createArtistQueue({
    artist: { name: 'Artist' },
    releases: [release('r1', 2024), release('r2', 2023)],
    popular: [],
    loadRelease: async (id) =>
      loaded(
        id === 'r1'
          ? [song('intro-a', 'Intro', ['Artist'], 30)]
          : [song('intro-b', 'Intro', ['Artist'], 90), song('intro-c', 'Intro', ['Artist'], 31)]
      ),
    isOffline: () => false
  })
  const all = [...((await queue.next()) ?? []), ...((await queue.next()) ?? [])]
  check('a same-titled recording with a different duration survives', all.some((item) => item.id === 'intro-b'))
  check('a same-titled recording with a close duration is deduped', !all.some((item) => item.id === 'intro-c'))
  check('only two Intros are queued', all.filter((item) => item.title === 'Intro').length === 2)
}

console.log('\nsingle-heavy artists still fill a batch:')
{
  const calls: string[] = []
  const releases = Array.from({ length: 6 }, (_, i) => release(`s${i}`, 2025 - i))
  const queue = createArtistQueue({
    artist: { name: 'Artist' },
    releases,
    popular: [],
    loadRelease: async (id) => {
      calls.push(id)
      return loaded([song(`${id}-track`, `Track ${id}`, ['Artist'])])
    },
    isOffline: () => false
  })
  const batch = (await queue.next()) ?? []
  check('five one-track releases make one batch', batch.length === 5, String(batch.length))
  check('only as many releases as needed were fetched', calls.length === 5, String(calls.length))
  const rest = (await queue.next()) ?? []
  check('the remaining release follows', rest.length === 1 && calls.length === 6)
}

console.log('\ncross-release dedupe:')
{
  const queue = createArtistQueue({
    artist: { name: 'Artist' },
    releases: [release('r1', 2024), release('r2', 2023)],
    popular: [],
    loadRelease: async (id) =>
      loaded(
        id === 'r1'
          ? [song('i1', 'Intro', ['Artist']), song('x1', 'One', ['Artist'])]
          : [song('i2', 'Intro', ['Artist']), song('y1', 'Two', ['Artist'])]
      ),
    isOffline: () => false
  })
  const all = [...((await queue.next()) ?? []), ...((await queue.next()) ?? [])]
  check('one recording is queued once', all.filter((item) => item.title === 'Intro').length === 1)
  check('the other tracks survive', all.map((item) => item.title).join(',') === 'Intro,One,Two')
}

console.log('\nmissing credits inherit the page artist:')
{
  const queue = createArtistQueue({
    artist: { name: 'The Neighbourhood', id: 'UCn' },
    releases: [release('r1', 2024)],
    popular: [],
    loadRelease: async () => loaded([{ id: 'bare', kind: 'song', title: 'Bare', subtitle: '' }]),
    isOffline: () => false
  })
  const [item] = (await queue.next()) ?? []
  check('the row gains the artist name', item?.artists?.[0] === 'The Neighbourhood')
  check('the row gains a linked credit', item?.parts?.[0]?.artistId === 'UCn')
}

console.log('\nrelease art and metadata fill row gaps:')
{
  const card = release('r1', 2024)
  card.item.thumbnail = 'card.jpg'
  const queue = createArtistQueue({
    artist: { name: 'Artist' },
    releases: [card],
    popular: [],
    loadRelease: async () =>
      loaded(
        [
          {
            id: 'row-own',
            kind: 'song',
            title: 'Own Art',
            subtitle: '',
            thumbnail: 'row.jpg',
            album: 'Own Album',
            albumId: 'MPREb_own',
            releaseType: 'Single'
          },
          { id: 'row-bare', kind: 'song', title: 'Bare Art', subtitle: '' }
        ],
        { title: 'Header Album', thumbnail: 'header.jpg', releaseType: 'Album' }
      ),
    isOffline: () => false
  })
  const items = (await queue.next()) ?? []
  const own = items.find((item) => item.id === 'row-own')
  const bare = items.find((item) => item.id === 'row-bare')
  check('a row art wins over the header', own?.thumbnail === 'row.jpg', own?.thumbnail)
  check('a row album wins over the header', own?.album === 'Own Album' && own?.albumId === 'MPREb_own')
  check('the header art fills a bare row', bare?.thumbnail === 'header.jpg', bare?.thumbnail)
  check('the header title fills the album', bare?.album === 'Header Album', bare?.album)
  check('the header type fills the release type', bare?.releaseType === 'Album', bare?.releaseType)
  check('the release id becomes the album link', bare?.albumId === 'r1', bare?.albumId)
}

{
  const card = release('r1', 2024)
  card.item.thumbnail = 'card.jpg'
  const queue = createArtistQueue({
    artist: { name: 'Artist' },
    releases: [card],
    popular: [],
    loadRelease: async () =>
      loaded([{ id: 'bare', kind: 'song', title: 'Bare', subtitle: '' }], {
        title: 'No Header Art'
      }),
    isOffline: () => false
  })
  const [item] = (await queue.next()) ?? []
  check('the release card art is the last fallback', item?.thumbnail === 'card.jpg', item?.thumbnail)
}

console.log('\nfailed releases:')
{
  const calls: string[] = []
  const queue = createArtistQueue({
    artist: { name: 'Artist' },
    releases: [release('bad', 2024), release('empty', 2023), release('ok', 2022)],
    popular: [],
    loadRelease: async (id) => {
      calls.push(id)
      if (id === 'bad') throw new Error('network')
      if (id === 'empty') return loaded([])
      return loaded([song('ok-track', 'Fine', ['Artist'])])
    },
    isOffline: () => false
  })
  const batch = (await queue.next()) ?? []
  check('a failure does not abort the discography', calls.join(',') === 'bad,empty,ok', calls.join(','))
  check('the later release is queued', batch.some((item) => item.id === 'ok-track'))
}

{
  const calls: string[] = []
  const queue = createArtistQueue({
    artist: { name: 'Artist' },
    releases: Array.from({ length: 5 }, (_, i) => release(`r${i}`, 2025 - i)),
    popular: [],
    loadRelease: async (id) => {
      calls.push(id)
      throw new Error('offline')
    },
    isOffline: () => false
  })
  check('a run of failures exhausts the tail', (await queue.next()) === null)
  check('it stops after three failures', calls.length === 3, String(calls.length))
}

console.log('\ncancellation and offline:')
{
  let resolveLoad: ((value: ReturnType<typeof loaded>) => void) | null = null
  const queue = createArtistQueue({
    artist: { name: 'Artist' },
    releases: [release('r1', 2024), release('r2', 2023)],
    popular: [],
    loadRelease: () =>
      new Promise((resolve) => {
        resolveLoad = resolve
      }),
    isOffline: () => false
  })
  const pending = queue.next()
  check('hasMore is true while a release is loading', queue.hasMore() === true)
  check(
    'a release in flight is still in the saved tail',
    queue.persist()?.releaseIds.join(',') === 'r1,r2',
    JSON.stringify(queue.persist())
  )
  const same = queue.next()
  check('concurrent reads share one load', same === pending)
  queue.cancel()
  check('cancel drops the tail', queue.hasMore() === false)
  check('a cancelled tail persists nothing', queue.persist() === null)
  resolveLoad?.(loaded([song('late', 'Late', ['Artist'])]))
  check('a cancelled load returns nothing', (await pending) === null)
}

{
  const queue = createArtistQueue({
    artist: { name: 'Artist' },
    releases: [release('r1', 2024)],
    popular: [],
    loadRelease: async () => loaded([song('x', 'X', ['Artist'])]),
    isOffline: () => true
  })
  check('offline does not browse releases', (await queue.next()) === null)
}

console.log('\nrelease ids without a browse id:')
{
  const queue = createArtistQueue({
    artist: { name: 'Artist' },
    releases: [{ kind: 'Single', item: { id: 'single1', kind: 'album', title: 'S', subtitle: 'Single' } }],
    popular: [],
    loadRelease: async (id) => loaded([song(`${id}-track`, 'Only', ['Artist'])]),
    isOffline: () => false
  })
  const batch = (await queue.next()) ?? []
  check('an id is used when browseId is absent', batch[0]?.id === 'single1-track')
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
