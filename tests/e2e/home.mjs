import { sleep } from './lib.mjs'

export const description =
  'Home: recent history rows, the history panel, weekly pulse and mood entry points'

const titles = [
  'Home test one',
  'Home test two',
  'Home test three',
  'Home test four',
  'Home test five',
  'Home direct album test'
]
const thumb =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export async function run(app, check) {
  const now = Date.now()
  try {
    await app.evaluate(
      `(async () => {
        const { api } = window.__viby
        const tracks = [
          { id: 'home-test-a1', title: 'Home test one', album: 'Home test album one', albumId: 'home-album-one' },
          { id: 'home-test-a2', title: 'Home test two', album: 'Home test album one', albumId: 'home-album-one' },
          { id: 'home-test-b1', title: 'Home test three', album: 'Home test album two', albumId: 'home-album-two' },
          { id: 'home-test-c1', title: 'Home test four', album: 'Home test album three', albumId: 'home-album-three' },
          { id: 'home-test-d1', title: 'Home test five', album: 'Home test album four', albumId: 'home-album-four' }
        ]
        for (const track of tracks) {
          await api.history.add({
            trackId: track.id,
            title: track.title,
            artist: 'Home Test Artist',
            album: track.album,
            albumId: track.albumId,
            durationSec: 240,
            playedAt: ${now},
            completion: 1,
            thumbnail: ${JSON.stringify(thumb)}
          })
        }
        window.__viby.sidePanel.close()
        window.__viby.nav.go('library')
        await new Promise((resolve) => setTimeout(resolve, 250))
        window.__viby.nav.go('home')
        return true
      })()`,
      { userGesture: true }
    )

    let state = null
    for (let i = 0; i < 40; i++) {
      await sleep(150)
      state = await app.evaluate(`
        (() => ({
          dashboard: Boolean(document.querySelector('.dashboard')),
          rows: [...document.querySelectorAll('.recent-list li')].map((row) => ({
            title: row.querySelector('.title')?.textContent?.trim() ?? null,
            art: Boolean(row.querySelector('img')),
            artist: row.querySelector('.entity-link[data-entity="artist"]')?.textContent?.trim() ?? null,
            duration: row.querySelector('.dur')?.textContent?.trim() ?? null,
            actions: row.querySelectorAll('.row-action').length
          })),
          showMore: Boolean(document.querySelector('.recent-card .more')),
          pulse: document.querySelectorAll('.week-pulse > span').length,
          total: document.querySelector('.week-total')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
          moods: [...document.querySelectorAll('.mood-copy strong')].map((node) => node.textContent?.trim()),
          overflow: document.documentElement.scrollWidth > window.innerWidth
        }))()
      `)
      if (state.dashboard && state.rows.length === 5) break
    }

    console.log('  home:', JSON.stringify(state))
    check('Home shows the listening dashboard', state?.dashboard === true)
    check(
      'recent plays are five history rows, newest first',
      state?.rows.length === 5 &&
        state.rows.map((row) => row.title).join('|') ===
          'Home test five|Home test four|Home test three|Home test two|Home test one',
      JSON.stringify(state?.rows.map((row) => row.title))
    )
    check(
      'each row has art, artist, duration and actions',
      state?.rows.every(
        (row) => row.art && row.artist === 'Home Test Artist' && row.duration === '4:00' && row.actions >= 3
      ),
      JSON.stringify(state?.rows)
    )
    check('the card offers Show more', state?.showMore === true)
    check('the weekly card shows a seven-day pulse', state?.pulse === 7, `${state?.pulse}`)
    check('the listening total is rendered', /\d/.test(state?.total ?? ''), state?.total ?? '')
    check(
      'Home offers four mood cards',
      Array.isArray(state?.moods) && state.moods.join(',') === 'Focus,Energy,Late night,Throwbacks',
      JSON.stringify(state?.moods)
    )
    check('Home does not overflow horizontally', state?.overflow === false)

    const panel = await app.evaluate(
      `(async () => {
        document.querySelector('.recent-card .more')?.click()
        await new Promise((resolve) => setTimeout(resolve, 600))
        const rows = [...document.querySelectorAll('.panel .history li')].map((row) =>
          row.querySelector('.title')?.textContent?.trim()
        )
        return {
          mode: window.__viby.sidePanel.mode,
          open: document.querySelector('aside.panel')?.classList.contains('open') ?? false,
          eyebrow: document.querySelector('.panel .eyebrow')?.textContent?.trim() ?? null,
          count: document.querySelector('.panel .count')?.textContent?.trim() ?? null,
          seeded: rows.filter((title) => /^Home test/.test(title ?? '')).length,
          actions: document.querySelectorAll('.panel .history li .row-action').length
        }
      })()`,
      { userGesture: true }
    )
    check(
      'Show more opens the shared panel in history mode',
      panel.mode === 'history' && panel.open === true && panel.eyebrow === 'History',
      JSON.stringify(panel)
    )
    check('the panel lists the seeded plays', panel.seeded === 5, `${panel.seeded}`)
    check('the panel header counts the history', Number(panel.count) >= 5, String(panel.count))
    check('panel rows carry the row actions', panel.actions >= 15, `${panel.actions}`)

    const fav = await app.evaluate(
      `(async () => {
        const row = document.querySelector('.recent-list li')
        let button = row?.querySelector('[aria-label="Add to favourites"], [aria-label="Remove from favourites"]')
        // A previous failed run must not decide this test.
        if (button?.getAttribute('aria-label') === 'Remove from favourites') {
          button.click()
          await new Promise((resolve) => setTimeout(resolve, 500))
          button = row?.querySelector('[aria-label="Add to favourites"]')
        }
        const label = button?.getAttribute('aria-label') ?? null
        button?.click()
        await new Promise((resolve) => setTimeout(resolve, 500))
        const list = await window.__viby.api.favorites.list()
        const on = list.some((track) => track.id === 'home-test-d1')
        const nowLabel =
          document
            .querySelector('.recent-list li [aria-label="Add to favourites"], .recent-list li [aria-label="Remove from favourites"]')
            ?.getAttribute('aria-label') ?? null
        document.querySelector('.recent-list li [aria-label="Remove from favourites"]')?.click()
        await new Promise((resolve) => setTimeout(resolve, 500))
        const after = await window.__viby.api.favorites.list()
        return {
          label,
          on,
          nowLabel,
          removed: !after.some((track) => track.id === 'home-test-d1')
        }
      })()`,
      { userGesture: true }
    )
    check('a recent row can be favourited', fav.label === 'Add to favourites' && fav.on === true, JSON.stringify(fav))
    check('the heart reflects the saved state', fav.nowLabel === 'Remove from favourites', String(fav.nowLabel))
    check('the heart can undo itself', fav.removed === true, JSON.stringify(fav))

    const album = await app.evaluate(
      `(async () => {
        const { api, nav } = window.__viby
        await api.history.add({
          trackId: 'home-test-direct-album',
          title: 'Home direct album test',
          artist: 'Daft Punk',
          album: 'Random Access Memories',
          durationSec: 240,
          playedAt: Date.now(),
          completion: 1,
          thumbnail: ${JSON.stringify(thumb)}
        })
        nav.go('library')
        await new Promise((resolve) => setTimeout(resolve, 250))
        nav.go('home')
        let row = null
        for (let i = 0; i < 50; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          row = [...document.querySelectorAll('.recent-list li')].find(
            (node) => node.querySelector('.title')?.textContent?.trim() === 'Home direct album test'
          )
          if (row) break
        }
        row?.querySelector('.entity-link[data-entity="album"]')?.click()
        let label = null
        for (let i = 0; i < 80; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          label = document.querySelector('.hero .kind')?.textContent?.trim() ?? null
          if (nav.detail?.kind === 'album' && label) break
        }
        return {
          rowFound: Boolean(row),
          kind: nav.detail?.kind ?? null,
          title: document.querySelector('.hero h1')?.textContent?.trim() ?? null,
          label
        }
      })()`,
      { userGesture: true }
    )
    check(
      'clicking a release in a history row opens its album',
      album.rowFound && album.kind === 'album' && album.title === 'Random Access Memories',
      JSON.stringify(album)
    )
    check(
      "the release label comes from YouTube, not Viby's kind",
      album.label === 'Album',
      `${album.label ?? 'none'}`
    )
    await app.evaluate(`window.__viby.nav.go('home'); true`)

    // The same track can be played twice; the recent list must not key rows by
    // track id or Svelte aborts the whole dashboard.
    const duplicate = await app.evaluate(
      `(async () => {
        const { api, nav } = window.__viby
        await api.history.add({
          trackId: 'home-test-d1',
          title: 'Home test five',
          artist: 'Home Test Artist',
          album: 'Home test album four',
          albumId: 'home-album-four',
          durationSec: 240,
          playedAt: Date.now() + 1,
          completion: 1,
          thumbnail: ${JSON.stringify(thumb)}
        })
        nav.go('library')
        await new Promise((resolve) => setTimeout(resolve, 250))
        nav.go('home')
        await new Promise((resolve) => setTimeout(resolve, 900))
        return {
          dashboard: Boolean(document.querySelector('.dashboard')),
          titles: [...document.querySelectorAll('.recent-list li .title')].map((node) =>
            node.textContent?.trim()
          )
        }
      })()`,
      { userGesture: true }
    )
    check(
      'a replayed track never breaks the recent list',
      duplicate.dashboard === true &&
        duplicate.titles.length === 5 &&
        new Set(duplicate.titles).size === 5 &&
        duplicate.titles.filter((title) => title === 'Home test five').length === 1,
      JSON.stringify(duplicate)
    )

    const mood = await app.evaluate(
      `(async () => {
        const cards = [...document.querySelectorAll('.mood')]
        const icons = cards.map((card) => Boolean(card.querySelector('.mood-icon svg')))
        const images = cards.reduce((count, card) => count + card.querySelectorAll('img').length, 0)
        cards[0]?.click()
        let state = { title: null, shelves: 0, cards: 0 }
        for (let i = 0; i < 90; i++) {
          await new Promise((resolve) => setTimeout(resolve, 150))
          state = {
            title: window.__viby.nav.mood?.title ?? null,
            shelves: document.querySelectorAll('.mood-view .shelf').length,
            cards: document.querySelectorAll('.mood-view .card').length
          }
          if (state.shelves > 0) break
        }
        return { icons, images, ...state }
      })()`,
      { userGesture: true }
    )
    check(
      'mood cards use motion icons, not artwork',
      mood.icons.length === 4 && mood.icons.every(Boolean) && mood.images === 0,
      JSON.stringify(mood)
    )
    check(
      'a mood opens a YouTube Music mood page',
      mood.title === 'Focus' && mood.shelves > 0 && mood.cards > 0,
      JSON.stringify(mood)
    )
    await app.evaluate(`window.__viby.nav.go('home'); true`)
  } finally {
    await app.evaluate(
      `(async () => {
        const { api } = window.__viby
        await api.debug?.forgetHistory(${JSON.stringify(titles)})
        const favorites = await api.favorites.list()
        for (const track of favorites.filter((entry) => entry.id.startsWith('home-test-'))) {
          await api.favorites.toggle(track)
        }
        window.__viby.sidePanel.close()
        window.__viby.nav.go('home')
        return true
      })()`
    )
    await sleep(250)
  }
}
