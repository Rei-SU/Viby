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
}
