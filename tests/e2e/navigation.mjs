export const description = 'Navigation: drag strip, titlebar back/forward, artist page from search, search state restored'

export async function run(app, check) {
  const chrome = await app.evaluate(`
    (() => {
      const bar = document.querySelector('.titlebar')
      if (!bar) return { present: false }
      return {
        present: true,
        height: Math.round(bar.getBoundingClientRect().height),
        drag: getComputedStyle(bar).getPropertyValue('-webkit-app-region').trim() || 'unset'
      }
    })()
  `)
  check('window has a drag strip', chrome.present && chrome.height >= 32, JSON.stringify(chrome))

  const artist = await app.evaluate(`
    (async () => {
      const { nav } = window.__viby
      nav.go('search')
      await new Promise((r) => setTimeout(r, 300))
      const input = document.querySelector('.searchbox input')
      if (!input) return { ok: false, reason: 'no search input' }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'daft punk')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 3000))

      const rows = document.querySelectorAll('.results .row').length
      const link = document.querySelector('.results .inline-link')
      if (!link) return { ok: false, reason: 'no artist link', rows }
      const name = link.textContent.trim()
      link.click()
      await new Promise((r) => setTimeout(r, 3000))

      const bannerImg = document.querySelector('.artist-hero .banner-art')
      for (let i = 0; i < 20; i++) {
        if (bannerImg?.complete && bannerImg.naturalWidth > 0) break
        await new Promise((r) => setTimeout(r, 100))
      }

      return {
        ok: true,
        name,
        kind: nav.detail?.kind,
        header: document.querySelector('.artist-hero h1, .hero h1')?.textContent?.trim(),
        banner: Boolean(document.querySelector('.artist-hero .banner')),
        bannerArt: Boolean(document.querySelector('.banner-art')),
        bannerTag: bannerImg?.tagName ?? null,
        bannerLoaded: Boolean(bannerImg?.complete && bannerImg.naturalWidth > 0),
        listeners: document.querySelector('.banner .listeners')?.textContent?.trim() ?? null,
        rows: document.querySelectorAll('.tracks .row').length,
        tabs: [...document.querySelectorAll('.tab')].map((b) => b.textContent?.trim()),
        rails: document.querySelectorAll('.rail').length,
        searchRows: rows
      }
    })()
  `)

  check('search results render with artist links', artist.searchRows > 0, `${artist.searchRows} rows`)
  check('clicking an artist opens their page', artist.ok === true && artist.kind === 'artist', JSON.stringify(artist))
  check('artist page header matches', artist.header === artist.name, `"${artist.header}" vs "${artist.name}"`)
  check(
    'artist page uses a loaded banner image',
    artist.banner === true && artist.bannerArt === true && artist.bannerTag === 'IMG' && artist.bannerLoaded === true,
    JSON.stringify({ banner: artist.banner, art: artist.bannerArt, tag: artist.bannerTag, loaded: artist.bannerLoaded })
  )
  check('artist page lists tracks', artist.rows > 0, `${artist.rows} rows`)
  check(
    'artist page has a discography switcher',
    Array.isArray(artist.tabs) && artist.tabs.includes('Albums') && artist.tabs.includes('Singles & EPs'),
    JSON.stringify(artist.tabs)
  )
  check(
    'no video/live/featured tabs',
    Array.isArray(artist.tabs) && !artist.tabs.some((s) => /videos|live performances|featured on/i.test(s ?? '')),
    JSON.stringify(artist.tabs)
  )
  check('only one carousel', artist.rails === 1, `${artist.rails} rails`)

  const layout = await app.evaluate(`
    (() => {
      const banner = document.querySelector('.artist-hero .banner')
      const content = document.querySelector('main.content')
      if (!banner || !content) return null
      const b = banner.getBoundingClientRect()
      const c = content.getBoundingClientRect()
      return {
        left: Math.round(b.left - c.left),
        top: Math.round(b.top - c.top),
        right: Math.round(c.right - b.right),
        radius: getComputedStyle(banner).borderTopLeftRadius
      }
    })()
  `)
  check(
    'artist banner is full-bleed',
    Boolean(layout) &&
      Math.abs(layout.left) <= 1 &&
      Math.abs(layout.top) <= 1 &&
      layout.right <= 16 &&
      layout.radius === '0px',
    JSON.stringify(layout)
  )

  const historyControls = await app.evaluate(`
    (() => ({
      back: Boolean(document.querySelector('[aria-label="Back"]')),
      forward: Boolean(document.querySelector('[aria-label="Forward"]')),
      backDisabled: document.querySelector('[aria-label="Back"]')?.disabled ?? null,
      forwardDisabled: document.querySelector('[aria-label="Forward"]')?.disabled ?? null
    }))()
  `)
  check(
    'titlebar back/forward controls are available',
    historyControls.back &&
      historyControls.forward &&
      historyControls.backDisabled === false &&
      historyControls.forwardDisabled === true,
    JSON.stringify(historyControls)
  )

  const restored = await app.evaluate(`
    (async () => {
      document.querySelector('[aria-label="Back"]')?.click()
      await new Promise((r) => setTimeout(r, 900))
      return {
        query: document.querySelector('.searchbox input')?.value ?? null,
        rows: document.querySelectorAll('.results .row').length,
        chip: document.querySelector('.chip.on')?.textContent?.trim() ?? null,
        forwardDisabled: document.querySelector('[aria-label="Forward"]')?.disabled ?? null
      }
    })()
  `)
  check('back restores the search query', restored.query === 'daft punk', JSON.stringify(restored))
  check('back restores the search results', restored.rows > 0, `${restored.rows} rows`)
  check('back enables forward', restored.forwardDisabled === false, JSON.stringify(restored))

  const forwarded = await app.evaluate(`
    (async () => {
      document.querySelector('[aria-label="Forward"]')?.click()
      await new Promise((r) => setTimeout(r, 1800))
      return {
        kind: window.__viby.nav.detail?.kind ?? null,
        header: document.querySelector('.artist-hero h1, .hero h1')?.textContent?.trim() ?? null
      }
    })()
  `)
  check('forward restores the artist page', forwarded.kind === 'artist' && forwarded.header === artist.name, JSON.stringify(forwarded))

  const restoredAgain = await app.evaluate(`
    (async () => {
      document.querySelector('[aria-label="Back"]')?.click()
      await new Promise((r) => setTimeout(r, 900))
      return {
        query: document.querySelector('.searchbox input')?.value ?? null,
        rows: document.querySelectorAll('.results .row').length
      }
    })()
  `)
  check('back after forward returns to search', restoredAgain.query === 'daft punk' && restoredAgain.rows > 0, JSON.stringify(restoredAgain))

  // A known artist has monthly-listener data; small pages (like the one above)
  // may omit it, which is why that line is conditional in the UI.
  const known = await app.evaluate(`
    (async () => {
      window.__viby.nav.openArtist('UCRr1xG_2WIDs18a6cIiCxeA', 'Daft Punk')
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 250))
        if (document.querySelector('.banner .listeners')) break
      }
      return {
        header: document.querySelector('.artist-hero h1')?.textContent?.trim() ?? null,
        listeners: document.querySelector('.banner .listeners')?.textContent?.trim() ?? null,
        banner: Boolean(document.querySelector('.banner'))
      }
    })()
  `)
  check('known artist page shows monthly listeners', /monthly listeners/i.test(known.listeners ?? ''), JSON.stringify(known))
}
