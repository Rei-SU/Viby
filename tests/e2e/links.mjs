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
}
