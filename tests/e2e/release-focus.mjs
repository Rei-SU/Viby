export const description =
  'A song title opens its release at the row, singles open the song page, and queue titles follow'

export async function run(app, check) {
  // ---- album / EP: release page, scrolled to the row and flashed ----------
  const album = await app.evaluate(
    `(async () => {
      const { nav, searchState, player } = window.__viby
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      nav.go('search')
      await wait(300)
      searchState.setFilter('songs')
      searchState.setQuery('daft punk')
      searchState.submit('songs')

      let row = null
      for (let i = 0; i < 50 && !row; i++) {
        await wait(200)
        row = [...document.querySelectorAll('.results .row')].find(
          (candidate) =>
            candidate.querySelector('button.title') &&
            candidate.querySelector('.entity-link[data-entity="album"]')
        )
      }
      if (!row) return { found: false }

      const title = row.querySelector('button.title').textContent.trim()
      const albumName = row.querySelector('.entity-link[data-entity="album"]').textContent.trim()
      const clickedId = row.dataset.trackId
      const before = player.current?.id ?? null
      row.querySelector('button.title').click()

      let highlighted = null
      for (let i = 0; i < 80; i++) {
        await wait(100)
        const el = document.querySelector('.row.focused')
        if (el) {
          highlighted = {
            id: el.dataset.trackId,
            title: el.querySelector('button.title')?.textContent?.trim() ?? null,
            scrollTop: document.querySelector('.content')?.scrollTop ?? 0
          }
          break
        }
      }

      return {
        found: true,
        title,
        albumName,
        clickedId,
        before,
        after: player.current?.id ?? null,
        detail: nav.detail && { kind: nav.detail.kind, title: nav.detail.title, id: nav.detail.id },
        highlighted,
        highlightedId: highlighted?.id ?? null
      }
    })()`,
    { userGesture: true }
  )

  check(
    'a song title opens its release page',
    album.found && album.detail?.kind === 'album' && album.detail.title === album.albumName,
    JSON.stringify(album)
  )
  check(
    'the release scrolls to and highlights the clicked song',
    !!album.highlighted && album.highlighted.title === album.title,
    JSON.stringify(album.highlighted)
  )
  check(
    'the highlight does not start playback',
    album.before === album.after,
    `${album.before} → ${album.after}`
  )

  const faded = await app.evaluate(
    `(async () => {
      await new Promise((r) => setTimeout(r, 3200))
      return {
        focused: document.querySelectorAll('.row.focused').length,
        focus: window.__viby.nav.focus
      }
    })()`
  )
  check('the highlight is temporary', faded.focused === 0 && faded.focus === null, JSON.stringify(faded))

  // ---- queue: the same title affordance in the panel ----------------------
  const queue = await app.evaluate(
    `(async () => {
      const { nav, player, sidePanel } = window.__viby
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const detail = { id: nav.detail.id, title: nav.detail.title }
      // The last row starts below the fold, so this also proves the page scrolls.
      const rows = [...document.querySelectorAll('.tracks .row')]
      const row = rows[rows.length - 1]
      const track = {
        id: row.dataset.trackId,
        kind: 'song',
        title: row.querySelector('button.title')?.textContent?.trim() ?? row.textContent.trim(),
        subtitle: 'Daft Punk',
        artists: ['Daft Punk'],
        album: detail.title,
        albumId: detail.id,
        durationSec: 0
      }

      nav.go('home')
      player.clearQueue()
      player.enqueueAll([track])
      sidePanel.toggle('queue')
      await wait(450)
      const button = document.querySelector('.panel .queue .t')
      const tag = button?.tagName ?? null
      button?.click()

      let highlighted = null
      let rowEl = null
      for (let i = 0; i < 80; i++) {
        await wait(100)
        rowEl = document.querySelector('.row.focused')
        if (rowEl) {
          highlighted = { id: rowEl.dataset.trackId, title: rowEl.querySelector('button.title')?.textContent?.trim() ?? null }
          break
        }
      }
      await wait(900)
      const host = document.querySelector('.content')
      const view = host.getBoundingClientRect()
      const rect = rowEl?.getBoundingClientRect()
      const visible = !!rect && rect.top >= view.top && rect.bottom <= view.bottom
      sidePanel.close()
      return {
        tag,
        expected: track.title,
        detail: nav.detail && { kind: nav.detail.kind, title: nav.detail.title },
        highlighted,
        scrollTop: host.scrollTop,
        visible
      }
    })()`,
    { userGesture: true }
  )
  check(
    'queue titles are buttons',
    queue.tag === 'BUTTON',
    JSON.stringify(queue)
  )
  check(
    'a queue title opens the release at the row',
    queue.detail?.kind === 'album' && queue.highlighted?.title === queue.expected,
    JSON.stringify(queue)
  )
  check(
    'a below-fold row is scrolled into view',
    queue.visible === true,
    JSON.stringify({ scrollTop: queue.scrollTop, visible: queue.visible })
  )

  // ---- single: no release detour, straight to the song page ---------------
  const single = await app.evaluate(
    `(async () => {
      const { nav, searchState } = window.__viby
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      nav.go('search')
      await wait(300)
      searchState.setFilter('songs')
      searchState.setQuery('miley cyrus flowers')
      searchState.submit('songs')

      let row = null
      for (let i = 0; i < 50 && !row; i++) {
        await wait(200)
        row = [...document.querySelectorAll('.results .row')].find((candidate) =>
          candidate.querySelector('button.title')
        )
      }
      if (!row) return { found: false }

      const title = row.querySelector('button.title').textContent.trim()
      row.querySelector('button.title').click()

      let track = null
      for (let i = 0; i < 60; i++) {
        await wait(150)
        if (nav.track) {
          track = { title: nav.track.title, detail: nav.detail }
          break
        }
      }
      const heading = document.querySelector('.hero h1')?.textContent?.trim() ?? null
      const albumButton = document.querySelector('.byline .link')
      const albumName = albumButton?.textContent?.trim() ?? null
      albumButton?.click()

      let detail = null
      for (let i = 0; i < 40; i++) {
        await wait(150)
        if (nav.detail?.kind === 'album') {
          detail = { kind: nav.detail.kind, title: nav.detail.title, releaseType: nav.detail.releaseType }
          break
        }
      }

      return { found: true, title, track, heading, albumName, detail }
    })()`,
    { userGesture: true }
  )
  check(
    'a single title opens the song page, not the release',
    single.found && !!single.track && single.track.title === single.title && single.heading === single.title,
    JSON.stringify(single)
  )
  check(
    'the song page release name still opens the release',
    !!single.albumName && single.detail?.kind === 'album' && single.detail.title === single.albumName,
    JSON.stringify({ albumName: single.albumName, detail: single.detail })
  )
}
