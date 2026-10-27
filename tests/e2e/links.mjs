export const description = 'Player bar links: title → song page, artist → artist page'

export async function run(app, check) {
  const bar = await app.evaluate(
    `
    (async () => {
      const { nav } = window.__viby
      nav.go('search')
      await new Promise((r) => setTimeout(r, 300))
      const input = document.querySelector('.searchbox input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'daft punk')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 3000))
      document.querySelector('.results .row .main')?.click()
      await new Promise((r) => setTimeout(r, 4500))

      const p = window.__viby.player
      return {
        title: p.current?.title ?? null,
        artistId: p.current?.artistId ?? null,
        barArtistLink: !!document.querySelector('.dock .artist'),
        barTitle: document.querySelector('.dock .title')?.textContent?.trim() ?? null
      }
    })()
  `,
    { userGesture: true }
  )
  check('player bar has an artist link', bar.barArtistLink === true, JSON.stringify(bar))
  check('player bar title matches the track', bar.barTitle === bar.title, `"${bar.barTitle}"`)

  const songPage = await app.evaluate(`
    (async () => {
      document.querySelector('.dock .title')?.click()
      await new Promise((r) => setTimeout(r, 1500))
      return {
        heading: document.querySelector('.hero h1')?.textContent?.trim() ?? null,
        artistLink: !!document.querySelector('.byline .link'),
        related: document.querySelectorAll('.related .row').length
      }
    })()
  `)
  check('title opens the song page', songPage.heading === bar.title, `"${songPage.heading}"`)
  check('song page links to the artist', songPage.artistLink === true)
  check('song page lists related songs', songPage.related > 0, `${songPage.related} rows`)

  const cardArtist = await app.evaluate(`
    (async () => {
      const { nav } = window.__viby
      nav.go('search')
      await new Promise((r) => setTimeout(r, 300))
      const input = document.querySelector('.searchbox input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'daft punk')
      input.dispatchEvent(new Event('input', { bubbles: true }))

      let link = null
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 150))
        link = document.querySelector('.rail .card .entity-link[data-entity="artist"]')
        if (link) break
      }
      const name = link?.textContent?.trim() ?? null
      link?.click()
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 150))
        if (nav.detail?.kind === 'artist' && document.querySelector('.artist-hero h1, .hero h1')) break
      }
      return {
        found: Boolean(link),
        name,
        kind: nav.detail?.kind ?? null,
        header: document.querySelector('.artist-hero h1, .hero h1')?.textContent?.trim() ?? null
      }
    })()
  `)
  check(
    'card artist name opens the artist page',
    cardArtist.found && cardArtist.kind === 'artist' && cardArtist.header === cardArtist.name,
    JSON.stringify(cardArtist)
  )

  const rowAlbum = await app.evaluate(`
    (async () => {
      const { nav } = window.__viby
      nav.go('search')
      await new Promise((r) => setTimeout(r, 300))
      const input = document.querySelector('.searchbox input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'daft punk')
      input.dispatchEvent(new Event('input', { bubbles: true }))

      let link = null
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 150))
        link = document.querySelector('.results .row .entity-link[data-entity="album"]')
        if (link) break
      }
      const name = link?.textContent?.trim() ?? null
      link?.click()
      await new Promise((r) => setTimeout(r, 900))
      return {
        found: Boolean(link),
        name,
        kind: nav.detail?.kind ?? null,
        title: nav.detail?.title ?? null
      }
    })()
  `)
  check(
    'row album name opens the album page',
    rowAlbum.found && rowAlbum.kind === 'album' && rowAlbum.title === rowAlbum.name,
    JSON.stringify(rowAlbum)
  )

  // A collaboration must link each credited artist in the dock, not just the
  // first. Search results carry per-artist ids; the player used to collapse
  // them to one, so the second name was dead text.
  const featured = await app.evaluate(
    `
    (async () => {
      const { nav } = window.__viby
      nav.go('search')
      await new Promise((r) => setTimeout(r, 300))
      const input = document.querySelector('.searchbox input')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'daft punk')
      input.dispatchEvent(new Event('input', { bubbles: true }))

      // Collaborations move in and out of the top results, so try a few stable
      // queries before giving up.
      const queries = ['daft punk', 'stormy', 'get lucky', 'california love']
      let row = null
      let names = []
      let query = null
      for (const candidateQuery of queries) {
        const { searchState } = window.__viby
        nav.go('search')
        await new Promise((r) => setTimeout(r, 300))
        searchState.setQuery(candidateQuery)
        searchState.submit('songs')
        for (let i = 0; i < 40 && !row; i++) {
          await new Promise((r) => setTimeout(r, 200))
          for (const candidate of document.querySelectorAll('.results .row')) {
            const links = candidate.querySelectorAll('.entity-link[data-entity="artist"]')
            if (links.length >= 2) {
              row = candidate
              names = [...links].map((link) => link.textContent.trim())
              query = candidateQuery
              break
            }
          }
        }
        if (row) break
      }
      if (!row) return { found: false, queries }
      row.querySelector('.main')?.click()
      await new Promise((r) => setTimeout(r, 5000))

      const p = window.__viby.player
      const dockLinks = [...document.querySelectorAll('.dock .artist-link')].map((el) =>
        el.textContent.trim()
      )
      return {
        found: true,
        names,
        query,
        dockLinks,
        display: p.current?.artist ?? null,
        parts: (p.current?.artistParts ?? []).filter((part) => part.entity === 'artist' || part.artistId)
          .length
      }
    })()
  `,
    { userGesture: true }
  )
  check(
    'a collaboration links every artist in the dock',
    featured.found &&
      featured.dockLinks.length >= 2 &&
      featured.dockLinks.length === featured.parts &&
      (featured.display ?? '').includes(featured.dockLinks[0] ?? ''),
    JSON.stringify(featured)
  )

  // Track.artistParts is a nested array; the dock sends a plain snapshot over
  // IPC, so toggling a favourite must actually reach main and come back.
  const favToggle = await app.evaluate(`
    (async () => {
      const { player, api } = window.__viby
      const button = document.querySelector('.dock .fav')
      const id = player.current?.id ?? null
      const before = button?.classList.contains('on') ?? false
      button?.click()
      await new Promise((r) => setTimeout(r, 700))
      const list = await api.favorites.list()
      const after = list.some((track) => track.id === id)
      if (after !== before) {
        document.querySelector('.dock .fav')?.click()
        await new Promise((r) => setTimeout(r, 700))
      }
      return { id, before, after }
    })()
  `)
  check(
    'a multi-artist track survives the favourites IPC',
    !!favToggle.id && favToggle.after !== favToggle.before,
    JSON.stringify(favToggle)
  )

  const featuredClick = await app.evaluate(`
    (async () => {
      const links = [...document.querySelectorAll('.dock .artist-link')]
      const second = links[1]
      const name = second?.textContent?.trim() ?? null
      second?.click()
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 150))
        if (window.__viby.nav.detail?.kind === 'artist') break
      }
      const norm = (value) => (value ?? '').toLowerCase().replace(/\\s+/g, ' ').trim()
      const header = document.querySelector('.artist-hero h1, .hero h1')?.textContent?.trim() ?? null
      return {
        name,
        header,
        kind: window.__viby.nav.detail?.kind ?? null,
        matches: norm(name) === norm(header)
      }
    })()
  `)
  check(
    'the second credited artist opens their own page',
    !!featuredClick.name && featuredClick.kind === 'artist' && featuredClick.matches,
    JSON.stringify(featuredClick)
  )
}
