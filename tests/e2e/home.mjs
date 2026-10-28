import { sleep } from './lib.mjs'

export const description =
  'Home: recent history rows, the history panel, weekly listening stats and mood entry points'

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
          recentTitle: document.querySelector('.recent-card h2')?.textContent?.trim() ?? null,
          eyebrow: document.querySelector('.recent-card .eyebrow')?.textContent?.trim() ?? null,
          heads: (() => {
            const box = (selector) => {
              const el = document.querySelector(selector)
              if (!el) return null
              const r = el.getBoundingClientRect()
              return {
                top: Math.round(r.top * 10) / 10,
                bottom: Math.round(r.bottom * 10) / 10,
                height: Math.round(r.height * 10) / 10,
                centre: Math.round(((r.top + r.bottom) / 2) * 10) / 10
              }
            }
            return {
              title: box('.recent-card h2'),
              actions: box('.recent-card .head-actions'),
              card: box('.week-card'),
              weekTitle: box('.week-head h2'),
              clock: box('.week-clock')
            }
          })(),
          rowLead: (() => {
            const row = document.querySelector('.recent-list li')
            if (!row) return null
            const main = row.querySelector('.main')
            const art = row.querySelector('.art')
            return {
              main: Math.round(main.getBoundingClientRect().left),
              art: art ? Math.round(art.getBoundingClientRect().left) : null,
              index: Boolean(row.querySelector('.idx')),
              first: main.firstElementChild?.classList.contains('art') ?? false,
              rowRight: Math.round(row.getBoundingClientRect().right),
              durRight: Math.round(row.querySelector('.dur')?.getBoundingClientRect().right ?? 0),
              actions: Math.round(row.querySelector('.actions')?.getBoundingClientRect().width ?? 0)
            }
          })(),
          weekTitle: document.querySelector('.week-head h2')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
          weekClock: document.querySelector('.week-clock .pixel-clock')?.getAttribute('data-clock-value') ?? null,
          weekClockLabel: document.querySelector('.week-clock .pixel-clock')?.getAttribute('aria-label') ?? null,
          weekClockPixels: document.querySelectorAll('.week-clock .pixel-clock rect').length,
          weekUnits: [...document.querySelectorAll('.week-clock .unit')].map((node) =>
            node.textContent?.trim()
          ),
          weekSub: document.querySelector('.week-sub')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
          pulse: document.querySelectorAll('.week-pulse > span').length,
          shares: document.querySelectorAll('.week-card .share').length,
          weekRows: [...document.querySelectorAll('.week-card .artist')].map((row) => ({
            rank: row.querySelector('.rank')?.textContent?.trim() ?? null,
            name: row.querySelector('.artist-copy strong')?.textContent?.trim() ?? null,
            meta: row.querySelector('.artist-copy span')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
            time: row.querySelector('.artist-time')?.textContent?.trim() ?? null
          })),
          weekNote: document.querySelector('.week-note')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
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
    // "History" and "Recently played" meant the same thing twice, stacked. The
    // eyebrow is gone and the title sits on the actions' line, level with the
    // peer card's heading.
    check(
      'the history card has one title, with no eyebrow above it',
      state?.recentTitle === 'Recently played' && state?.eyebrow === null,
      JSON.stringify({ title: state?.recentTitle, eyebrow: state?.eyebrow })
    )
    check(
      'the history title, its actions and the week title share one line',
      Math.abs((state?.heads?.title?.top ?? 0) - (state?.heads?.weekTitle?.top ?? 99)) <= 1.5 &&
        Math.abs((state?.heads?.actions?.centre ?? 0) - (state?.heads?.title?.centre ?? 99)) <= 1.5,
      JSON.stringify(state?.heads)
    )
    // The clock is twice as tall as a title line. It starts on the title's line
    // and hangs below it, so it never crowds the card's top padding, and its
    // negative bottom margin keeps both cards' lists starting at the same y.
    check(
      'the week clock starts on the title line, clear of the card edge',
      Math.abs((state?.heads?.clock?.top ?? 0) - (state?.heads?.weekTitle?.top ?? 99)) <= 1.5 &&
        (state?.heads?.clock?.top ?? 0) - (state?.heads?.card?.top ?? 0) >= 16,
      JSON.stringify(state?.heads)
    )
    // The row used to reserve a 16px number column plus a 12px gap even when
    // there was no number to show, indenting every cover from the card's text.
    check(
      'history rows start at their artwork, with no empty number column',
      state?.rowLead?.index === false &&
        state.rowLead.first === true &&
        Math.abs((state.rowLead.art ?? 0) - (state.rowLead.main + 10)) <= 1,
      JSON.stringify(state?.rowLead)
    )
    // The hover actions used to hold a permanent 96px gutter beside every
    // duration. They now collapse to nothing and slide in only on hover.
    check(
      'hover actions take no room until the row is hovered',
      state?.rowLead?.actions === 0 &&
        Math.abs((state.rowLead.rowRight ?? 0) - (state.rowLead.durRight ?? 0) - 10) <= 1,
      JSON.stringify(state?.rowLead)
    )

    await app.send('DOM.enable')
    await app.send('CSS.enable')
    const tree = await app.send('DOM.getDocument', { depth: -1 })
    const rowNode = await app.send('DOM.querySelector', {
      nodeId: tree.result.root.nodeId,
      selector: '.recent-list li'
    })
    await app.send('CSS.forcePseudoState', {
      nodeId: rowNode.result.nodeId,
      forcedPseudoClasses: ['hover']
    })
    await sleep(400)
    const hovered = await app.evaluate(`(() => {
      const row = document.querySelector('.recent-list li')
      const actions = row.querySelector('.actions')
      return {
        actions: Math.round(actions.getBoundingClientRect().width),
        buttons: [...actions.querySelectorAll('.row-action')].map((button) =>
          Math.round(button.getBoundingClientRect().width)
        ),
        rowRight: Math.round(row.getBoundingClientRect().right),
        durRight: Math.round(row.querySelector('.dur').getBoundingClientRect().right)
      }
    })()`)
    await app.send('CSS.forcePseudoState', {
      nodeId: rowNode.result.nodeId,
      forcedPseudoClasses: []
    })
    await sleep(300)
    check(
      'hovering a row slides its actions in and the duration steps aside',
      hovered.actions === 96 &&
        hovered.buttons.length === 3 &&
        hovered.buttons.every((width) => width === 28) &&
        Math.abs(hovered.rowRight - hovered.durRight - 106) <= 1,
      JSON.stringify(hovered)
    )
    check(
      'the weekly card uses the Vibing Time title',
      state?.weekTitle === 'Vibing Time this week',
      String(state?.weekTitle)
    )
    check(
      'the time is a pixel clock beside the title',
      /^\d{2,3}:\d{2}$/.test(state?.weekClock ?? '') &&
        state.weekClockPixels > 20 &&
        /listened this week/.test(state?.weekClockLabel ?? '') &&
        state.weekUnits.join(',') === 'HRS,MIN',
      JSON.stringify({
        clock: state?.weekClock,
        label: state?.weekClockLabel,
        pixels: state?.weekClockPixels,
        units: state?.weekUnits
      })
    )
    check(
      'the plays and songs sit under the title',
      /plays/.test(state?.weekSub ?? '') && /songs/.test(state?.weekSub ?? ''),
      String(state?.weekSub)
    )
    check('the old week chart is gone', state?.pulse === 0, `${state?.pulse}`)
    check(
      'top artists are ranked without progress bars',
      state?.shares === 0 &&
        state.weekRows.length > 0 &&
        state.weekRows.every((row) => row.rank && row.name && row.meta),
      JSON.stringify(state?.weekRows)
    )
    check(
      'the most active day is rendered',
      (state?.weekNote ?? '').includes('Most active day'),
      JSON.stringify({ note: state?.weekNote })
    )
    check(
      'Home offers four mood cards',
      Array.isArray(state?.moods) && state.moods.join(',') === 'Focus,Energy,Late night,Throwbacks',
      JSON.stringify(state?.moods)
    )
    check('Home does not overflow horizontally', state?.overflow === false)

    // The docked panel narrows the content column without resizing the window.
    // Before the header wrapped, "Vibing Time this week" ran into the pixel
    // clock as soon as the two cards were ~320px wide (PLAN §13).
    const narrow = await app.evaluate(
      `(async () => {
        const root = document.documentElement
        const { sidePanel } = window.__viby
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        try {
          root.style.setProperty('--panel-w', '460px')
          sidePanel.toggle('queue')
          await wait(800)
          const h2 = document.querySelector('.week-head h2')
          const clock = document.querySelector('.week-clock')
          const card = document.querySelector('.week-card')
          if (!h2 || !clock || !card) return { found: false }
          const range = document.createRange()
          range.selectNodeContents(h2)
          const text = range.getBoundingClientRect()
          const box = clock.getBoundingClientRect()
          const overlapX = Math.min(text.right, box.right) - Math.max(text.left, box.left)
          const overlapY = Math.min(text.bottom, box.bottom) - Math.max(text.top, box.top)
          return {
            found: true,
            card: Math.round(card.getBoundingClientRect().width),
            overlaps: overlapX > 0 && overlapY > 0,
            // The heading may wrap, but the clock must stay anchored on the
            // title's row instead of being pushed underneath it.
            clockOnTitleRow: box.top < text.bottom,
            wrapped: range.getClientRects().length > 1,
            gapX: Math.round(box.left - text.right),
            gapY: Math.round(box.top - text.bottom)
          }
        } finally {
          sidePanel.close()
          root.style.removeProperty('--panel-w')
          await wait(400)
        }
      })()`,
      { userGesture: true }
    )
    check(
      'the weekly heading never overlaps the pixel clock in a narrow column',
      narrow.found === true && narrow.overlaps === false,
      JSON.stringify(narrow)
    )
    check(
      'the clock keeps its place and "this week" wraps instead',
      narrow.found === true && narrow.clockOnTitleRow === true,
      JSON.stringify(narrow)
    )

    // The clock scrambles once per mount, then settles. Leaving and returning
    // to Home remounts it; no CSS animation should keep running.
    const boot = await app.evaluate(
      `(async () => {
        const { nav } = window.__viby
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        const first = document.querySelector('.week-clock .pixel-clock')
        nav.go('library')
        await wait(350)
        nav.go('home')
        let second = null
        for (let i = 0; i < 60 && !second; i++) {
          await wait(100)
          second = document.querySelector('.week-clock .pixel-clock')
        }
        const sawScramble = second?.getAttribute('data-scrambling') === 'true'
        for (let i = 0; i < 40 && second?.getAttribute('data-scrambled') !== 'true'; i++) {
          await wait(100)
        }
        const clock = document.querySelector('.week-clock .pixel-clock')
        const style = clock ? getComputedStyle(clock.querySelector('.clock')) : null
        return {
          remounted: Boolean(first && clock && first !== clock),
          sawScramble,
          settled: clock?.getAttribute('data-scrambled') === 'true',
          display: clock?.getAttribute('data-display') ?? null,
          value: clock?.getAttribute('data-clock-value') ?? null,
          animation: style?.animationName ?? null
        }
      })()`,
      { userGesture: true }
    )
    check(
      'the pixel clock scrambles once when Home returns',
      boot.remounted &&
        boot.settled &&
        boot.display === boot.value &&
        boot.animation === 'none',
      JSON.stringify(boot)
    )

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
