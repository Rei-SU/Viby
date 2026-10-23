export const description = 'Search: centered titlebar field, grouped quick results, show-more routing, recents'

export async function run(app, check) {
  const layout = await app.evaluate(`
    (() => {
      const input = document.querySelector('.searchbox input')
      const bar = document.querySelector('.titlebar')
      const box = document.querySelector('.searchbox')?.getBoundingClientRect()
      const profile = document.querySelector('.profile')
      if (!input || !bar || !box) return null
      return {
        inputs: document.querySelectorAll('.searchbox input').length,
        inTitlebar: bar.contains(input),
        center: Math.round((box.left + box.right) / 2 - innerWidth / 2),
        top: Math.round(box.top - bar.getBoundingClientRect().top),
        height: Math.round(box.height),
        profile: Boolean(profile),
        profileRadius: profile ? getComputedStyle(profile).borderRadius : null
      }
    })()
  `)
  check('titlebar hosts the only search input', Boolean(layout) && layout.inputs === 1 && layout.inTitlebar, JSON.stringify(layout))
  check(
    'search field is centered in the titlebar',
    Boolean(layout) && Math.abs(layout.center) <= 1 && layout.top >= 4 && layout.height >= 30,
    JSON.stringify(layout)
  )
  check(
    'profile placeholder sits on the right',
    Boolean(layout) && layout.profile && layout.profileRadius === '50%',
    JSON.stringify(layout)
  )

  const quick = await app.evaluate(`
    (async () => {
      const { nav } = window.__viby
      nav.go('home')
      await new Promise((r) => setTimeout(r, 300))

      const input = document.querySelector('.searchbox input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.focus()
      await new Promise((r) => setTimeout(r, 300))

      const empty = {
        open: (document.querySelector('.searchbox input')?.getAttribute('aria-expanded') === 'true'),
        recents: document.querySelectorAll('.quick-row.recent').length,
        hint: Boolean(document.querySelector('.quick-empty'))
      }

      setter.call(input, 'daft punk')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      for (let i = 0; i < 70; i++) {
        await new Promise((r) => setTimeout(r, 150))
        if (document.querySelectorAll('.quick-section').length >= 3 && !document.querySelector('.pip')) break
      }
      await new Promise((r) => setTimeout(r, 250))

      const sections = [...document.querySelectorAll('.quick-section')].map((section) => ({
        id: section.dataset.group,
        rows: section.querySelectorAll('.quick-row').length,
        more: Boolean(section.querySelector('.show-more'))
      }))
      const panel = document.querySelector('.quick-panel')?.getBoundingClientRect()
      const foot = document.querySelector('.quick-foot')?.getBoundingClientRect()

      return {
        empty,
        open: (document.querySelector('.searchbox input')?.getAttribute('aria-expanded') === 'true'),
        sections,
        more: document.querySelectorAll('.show-more').length,
        foot: foot ? { top: Math.round(foot.top), bottom: Math.round(foot.bottom) } : null,
        listScrolls: (() => {
          const list = document.querySelector('.quick-list')
          return list ? list.scrollHeight > list.clientHeight : false
        })(),
        panel: panel
          ? {
              top: Math.round(panel.top),
              bottom: Math.round(panel.bottom),
              width: Math.round(panel.width)
            }
          : null,
        viewport: { w: innerWidth, h: innerHeight },
        hasAlbums: sections.some((section) => section.id === 'albums')
      }
    })()
  `)

  check('focused empty search shows recents or a hint', quick.empty.open && (quick.empty.recents > 0 || quick.empty.hint), JSON.stringify(quick.empty))
  check(
    'quick results group songs, artists and playlists',
    quick.open &&
      quick.sections.map((section) => section.id).join(',') === 'songs,artists,playlists' &&
      !quick.hasAlbums,
    JSON.stringify(quick.sections)
  )
  check(
    'each category is capped at five with a show-more action',
    quick.sections.length === 3 &&
      quick.sections.every((section) => section.rows > 0 && section.rows <= 5 && section.more),
    JSON.stringify(quick.sections)
  )
  check(
    'quick panel stays inside the window with a visible footer',
    Boolean(quick.panel) &&
      quick.panel.top >= 46 &&
      quick.panel.bottom <= quick.viewport.h - 80 &&
      Boolean(quick.foot) &&
      quick.foot.bottom <= quick.panel.bottom + 1 &&
      quick.foot.top >= quick.panel.top,
    JSON.stringify({ panel: quick.panel, foot: quick.foot, scrolls: quick.listScrolls })
  )

  const entered = await app.evaluate(`
    (async () => {
      const input = document.querySelector('.searchbox input')
      // Reset keyboard selection and refocus the field before asserting the
      // no-highlight Enter path. Pointer hover never sets a selection.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', keyCode: 75, which: 75, metaKey: true, bubbles: true }))
      await new Promise((r) => setTimeout(r, 150))
      input.focus()
      await new Promise((r) => setTimeout(r, 120))
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })
      )
      await new Promise((r) => setTimeout(r, 2400))
      return {
        view: window.__viby.nav.view,
        query: input.value,
        chip: [...document.querySelectorAll('.chip')].find((chip) => chip.classList.contains('on'))?.textContent?.trim() ?? null,
        title: document.querySelector('.view h1')?.textContent?.trim() ?? null,
        forText: document.querySelector('.view .for')?.textContent?.trim() ?? null,
        rows: document.querySelectorAll('.results .row').length,
        open: (document.querySelector('.searchbox input')?.getAttribute('aria-expanded') === 'true'),
        pageInputs: document.querySelectorAll('.view .searchbox input').length
      }
    })()
  `)
  check('Enter with no highlight opens the Search page', entered.view === 'search' && entered.open === false, JSON.stringify(entered))
  check('Search page defaults to All results', entered.chip === 'All' && entered.rows > 0, JSON.stringify(entered))
  check('Search page reflects the committed query', entered.query === 'daft punk' && entered.forText?.includes('daft punk') && entered.title === 'Search', JSON.stringify(entered))
  check('Search page has no duplicate input', entered.pageInputs === 0, JSON.stringify(entered))

  const more = await app.evaluate(`
    (async () => {
      const { nav } = window.__viby
      nav.go('home')
      await new Promise((r) => setTimeout(r, 300))
      const input = document.querySelector('.searchbox input')
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'daft punk')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 150))
        if (document.querySelector('[data-group="artists"] .show-more')) break
      }
      document.querySelector('[data-group="artists"] .show-more')?.click()
      await new Promise((r) => setTimeout(r, 2200))
      return {
        view: window.__viby.nav.view,
        chip: [...document.querySelectorAll('.chip')].find((chip) => chip.classList.contains('on'))?.textContent?.trim() ?? null,
        open: (document.querySelector('.searchbox input')?.getAttribute('aria-expanded') === 'true'),
        cards: document.querySelectorAll('.card-grid .card').length
      }
    })()
  `)
  check('Show more opens the Search page in that category', more.view === 'search' && more.open === false && more.chip === 'Artists', JSON.stringify(more))
  check(
    'category results are actually artists',
    more.cards > 0 && more.chip === 'Artists',
    JSON.stringify({ cards: more.cards, chip: more.chip })
  )

  const recent = await app.evaluate(`
    (async () => {
      const { nav } = window.__viby
      nav.go('home')
      await new Promise((r) => setTimeout(r, 300))
      const input = document.querySelector('.searchbox input')
      input.focus()
      document.querySelector('.clear')?.click()
      await new Promise((r) => setTimeout(r, 350))
      const rows = [...document.querySelectorAll('.quick-row.recent .row-title')].map((row) => row.textContent?.trim())
      const target = [...document.querySelectorAll('.quick-row.recent')].find((row) =>
        row.textContent?.toLowerCase().includes('daft punk')
      )
      target?.click()
      await new Promise((r) => setTimeout(r, 2000))
      return {
        rows,
        query: input.value,
        view: window.__viby.nav.view,
        chip: [...document.querySelectorAll('.chip')].find((chip) => chip.classList.contains('on'))?.textContent?.trim() ?? null,
        open: (document.querySelector('.searchbox input')?.getAttribute('aria-expanded') === 'true')
      }
    })()
  `)
  check('committed queries appear in recent searches', recent.rows.some((row) => row?.toLowerCase().includes('daft punk')), JSON.stringify(recent.rows))
  check('clicking a recent search opens All results', recent.view === 'search' && recent.chip === 'All' && recent.query === 'daft punk' && recent.open === false, JSON.stringify(recent))

  const song = await app.evaluate(`
    (async () => {
      const { nav, player } = window.__viby
      nav.go('home')
      await new Promise((r) => setTimeout(r, 300))
      const input = document.querySelector('.searchbox input')
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'instant crush')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 150))
        if (document.querySelector('.quick-section [data-kind="song"]')) break
      }
      const row = document.querySelector('.quick-section [data-kind="song"]')
      const title = row?.querySelector('.row-title')?.textContent?.trim() ?? null
      row?.click()
      await new Promise((r) => setTimeout(r, 2600))
      return {
        title,
        view: nav.view,
        playerTitle: player.current?.title ?? null,
        playing: player.playing,
        queueLength: player.queue.length,
        open: (document.querySelector('.searchbox input')?.getAttribute('aria-expanded') === 'true')
      }
    })()
  `)
  check(
    'clicking a song plays it alone, without the other search rows',
    song.view === 'home' && song.playing === true && /instant crush/i.test(song.playerTitle ?? '') && song.queueLength === 1 && song.open === false,
    JSON.stringify(song)
  )

  const keyboard = await app.evaluate(`
    (async () => {
      const { nav, player } = window.__viby
      nav.go('home')
      await new Promise((r) => setTimeout(r, 300))
      const input = document.querySelector('.searchbox input')
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'one more time')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 150))
        if (document.querySelector('.quick-row[data-kind="song"]')) break
      }
      // Reset the selection before testing ArrowDown so it is chosen
      // deterministically by the keyboard.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', keyCode: 75, which: 75, metaKey: true, bubbles: true }))
      await new Promise((r) => setTimeout(r, 150))
      input.focus()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }))
      await new Promise((r) => setTimeout(r, 300))
      const active = document.querySelector('.quick-row.active')
      const activeTitle = active?.querySelector('.row-title')?.textContent?.trim() ?? null
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 150))
        if (!document.querySelector('.quick-panel')) break
      }
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 250))
        if (player.current?.title === activeTitle && player.playing) break
      }
      return {
        activeKind: active?.dataset.kind ?? null,
        activeTitle,
        view: nav.view,
        playerTitle: player.current?.title ?? null,
        playing: player.playing,
        open: (document.querySelector('.searchbox input')?.getAttribute('aria-expanded') === 'true')
      }
    })()
  `)
  check(
    'arrow + Enter opens the highlighted result',
    keyboard.activeKind === 'song' &&
      keyboard.activeTitle === keyboard.playerTitle &&
      keyboard.playing === true &&
      keyboard.view === 'home' &&
      keyboard.open === false,
    JSON.stringify(keyboard)
  )

  const staleHover = await app.evaluate(`
    (async () => {
      const { nav, player } = window.__viby
      nav.go('home')
      await new Promise((r) => setTimeout(r, 300))
      const input = document.querySelector('.searchbox input')
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'daft punk')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 150))
        if (document.querySelector('.quick-row[data-kind="song"]')) break
      }
      const row = document.querySelector('.quick-row[data-kind="song"]')
      const before = player.current?.id ?? null
      row?.dispatchEvent(new PointerEvent('pointerenter'))
      await new Promise((r) => setTimeout(r, 50))
      const hoverIsNotSelection = !document.querySelector('.quick-row.active')
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
      await new Promise((r) => setTimeout(r, 1800))
      return {
        hoverIsNotSelection,
        view: nav.view,
        playerChanged: (player.current?.id ?? null) !== before,
        open: (document.querySelector('.searchbox input')?.getAttribute('aria-expanded') === 'true')
      }
    })()
  `)
  check(
    'hovering a row never becomes the Enter target',
    staleHover.hoverIsNotSelection &&
      staleHover.view === 'search' &&
      staleHover.playerChanged === false &&
      staleHover.open === false,
    JSON.stringify(staleHover)
  )

  const keys = await app.evaluate(`
    (async () => {
      window.__viby.nav.go('home')
      await new Promise((r) => setTimeout(r, 300))
      const input = document.querySelector('.searchbox input')
      input.focus()
      input.value = 'daft punk'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 900))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }))
      await new Promise((r) => setTimeout(r, 200))
      const escaped = (document.querySelector('.searchbox input')?.getAttribute('aria-expanded') === 'true') === false
      input.click()
      await new Promise((r) => setTimeout(r, 200))
      const reopenedByClick = (document.querySelector('.searchbox input')?.getAttribute('aria-expanded') === 'true')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', keyCode: 75, which: 75, metaKey: true, bubbles: true }))
      await new Promise((r) => setTimeout(r, 300))
      return {
        escaped,
        reopenedByClick,
        focused: document.activeElement === input,
        reopened: (document.querySelector('.searchbox input')?.getAttribute('aria-expanded') === 'true')
      }
    })()
  `)
  check('Escape closes, a click reopens, and Cmd/Ctrl+K focuses', keys.escaped && keys.reopenedByClick && keys.focused && keys.reopened, JSON.stringify(keys))

  const profile = await app.evaluate(`
    (async () => {
      document.querySelector('.profile')?.click()
      await new Promise((r) => setTimeout(r, 200))
      return { note: document.querySelector('.profile-note')?.textContent?.trim() ?? null }
    })()
  `)
  check('profile placeholder is present and explains itself', profile.note === 'Profiles are coming later.', JSON.stringify(profile))
}
