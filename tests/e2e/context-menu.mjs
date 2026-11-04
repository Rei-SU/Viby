export const description = 'Context menu: quick search, top result, rows and album cards'

export async function run(app, check) {
  const quick = await app.evaluate(`
    (async () => {
      const { nav } = window.__viby
      nav.go('home')
      await new Promise((r) => setTimeout(r, 250))
      const input = document.querySelector('.searchbox input')
      if (!input) return { ok: false, reason: 'no search input' }
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'instant crush')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 2500))

      const rows = [...document.querySelectorAll('.quick-row[data-kind="song"]')]
      if (rows.length === 0) {
        return { ok: false, reason: 'no song in quick search', rows: document.querySelectorAll('.quick-row').length }
      }
      const row = rows[0]
      row.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 160,
          clientY: 200,
          button: 2
        })
      )
      await new Promise((r) => setTimeout(r, 80))
      const menu = document.querySelector('[role="menu"]')
      const labels = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((b) =>
        b.textContent.trim()
      )
      return {
        ok: true,
        labels,
        menuOpen: Boolean(menu)
      }
    })()
  `)
  check('quick search opens a song menu', quick.ok && quick.menuOpen === true, JSON.stringify(quick))
  for (const label of ['Play', 'Play next', 'Add to queue', 'Add to playlist', 'Like', 'Download', 'Go to artist', 'Go to album']) {
    check(`quick menu has ${label}`, Array.isArray(quick.labels) && quick.labels.includes(label), JSON.stringify(quick.labels))
  }

  const submenu = await app.evaluate(`
    (async () => {
      const trigger = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find(
        (b) => b.textContent.trim() === 'Add to playlist'
      )
      trigger?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 180))
      const flyout = document.querySelector('.menu.submenu')
      const result = {
        open: Boolean(flyout),
        search: Boolean(flyout?.querySelector('.filter')),
        create: [...(flyout?.querySelectorAll('button') ?? [])].some((b) =>
          b.textContent.includes('New playlist')
        )
      }
      trigger?.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 260))
      return { ...result, closed: !document.querySelector('.menu.submenu') }
    })()
  `)
  check('Add to playlist opens a flyout on hover', submenu.open === true, JSON.stringify(submenu))
  check('the flyout has playlist search', submenu.search === true, JSON.stringify(submenu))
  check('the flyout has Create playlist', submenu.create === true, JSON.stringify(submenu))
  check('leaving closes the flyout', submenu.closed === true, JSON.stringify(submenu))

  const dismissed = await app.evaluate(`
    (async () => {
      const menu = document.querySelector('[role="menu"]')
      menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await new Promise((r) => setTimeout(r, 80))
      return Boolean(document.querySelector('[role="menu"]'))
    })()
  `)
  check('Escape closes the menu', dismissed === false)

  const top = await app.evaluate(`
    (async () => {
      const input = document.querySelector('.searchbox input')
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await new Promise((r) => setTimeout(r, 2500))
      const card = document.querySelector('.top-card')
      const type = document.querySelector('.top-type')?.textContent?.trim() ?? null
      if (!card) return { ok: false, reason: 'no top result' }

      const queueBefore = window.__viby.player.queue.length
      card.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 180,
          clientY: 220,
          button: 2
        })
      )
      await new Promise((r) => setTimeout(r, 80))
      const labels = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((b) =>
        b.textContent.trim()
      )
      const add = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find(
        (b) => b.textContent.trim() === 'Add to queue'
      )
      add?.click()
      await new Promise((r) => setTimeout(r, 250))
      return {
        ok: true,
        type,
        labels,
        queueBefore,
        queueAfter: window.__viby.player.queue.length
      }
    })()
  `)
  check('the top result opens a menu', top.ok === true && Array.isArray(top.labels), JSON.stringify(top))
  check('the top result menu downloads songs', Array.isArray(top.labels) && top.labels.includes('Download'), JSON.stringify(top.labels))
  check(
    'Add to queue from the top result works',
    top.ok && top.queueAfter === top.queueBefore + 1,
    JSON.stringify({ before: top.queueBefore, after: top.queueAfter })
  )

  const added = await app.evaluate(`
    (async () => {
      const { playlists } = await import('/lib/playlists.svelte.ts')
      await playlists.load()
      const created = await playlists.create('Submenu test')
      const card = document.querySelector('.top-card')
      card?.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 180,
          clientY: 220,
          button: 2
        })
      )
      await new Promise((r) => setTimeout(r, 100))
      const trigger = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find(
        (b) => b.textContent.trim() === 'Add to playlist'
      )
      trigger?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 180))
      const target = [...document.querySelectorAll('.menu.submenu button')].find((b) =>
        b.textContent.includes('Submenu test')
      )
      target?.click()
      await new Promise((r) => setTimeout(r, 600))
      const count = playlists.byId(created.id)?.tracks.length ?? -1
      await playlists.remove(created.id)
      return { count, menuClosed: !document.querySelector('[role="menu"]') }
    })()
  `)
  check('a playlist can be chosen from the flyout', added.count === 1, JSON.stringify(added))
  check('the menu closes after adding', added.menuClosed === true, JSON.stringify(added))

  const album = await app.evaluate(`
    (async () => {
      const { nav } = window.__viby
      nav.go('search')
      await new Promise((r) => setTimeout(r, 250))
      const input = document.querySelector('.searchbox input')
      input?.focus()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'random access memories')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 2500))
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await new Promise((r) => setTimeout(r, 2500))

      const card = [...document.querySelectorAll('.card')].find((node) =>
        /album/i.test(node.querySelector('.card-sub')?.textContent ?? '')
      )
      if (!card) return { ok: false, reason: 'no album card' }

      card.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 200,
          clientY: 240,
          button: 2
        })
      )
      await new Promise((r) => setTimeout(r, 80))
      const labels = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((b) =>
        b.textContent.trim()
      )
      return { ok: true, labels }
    })()
  `)
  check('album cards open a menu', album.ok === true && Array.isArray(album.labels), JSON.stringify(album))
  for (const label of ['Play', 'Add to queue', 'Add to playlist', 'Save to Library', 'Download', 'Go to artist']) {
    check(`album menu has ${label}`, Array.isArray(album.labels) && album.labels.includes(label), JSON.stringify(album.labels))
  }

  const saved = await app.evaluate(`
    (async () => {
      const find = (label) =>
        [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find(
          (b) => b.textContent.trim() === label
        )
      find('Save to Library')?.click()
      await new Promise((r) => setTimeout(r, 250))

      const card = [...document.querySelectorAll('.card')].find((node) =>
        /album/i.test(node.querySelector('.card-sub')?.textContent ?? '')
      )
      card?.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 200,
          clientY: 240,
          button: 2
        })
      )
      await new Promise((r) => setTimeout(r, 80))
      const labels = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((b) =>
        b.textContent.trim()
      )
      find('Remove from Library')?.click()
      await new Promise((r) => setTimeout(r, 250))
      return { labels }
    })()
  `)
  check(
    'saving a release updates the menu',
    Array.isArray(saved.labels) && saved.labels.includes('Remove from Library'),
    JSON.stringify(saved.labels)
  )

  await app.evaluate(`window.__viby.nav.go('home')`)
}
