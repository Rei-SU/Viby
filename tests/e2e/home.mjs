import { sleep } from './lib.mjs'

export const description = 'Home: listening snapshot, grouped recents, weekly pulse, mood navigation'

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
          groups: [...document.querySelectorAll('.recent-group')].map((group) => ({
            title: group.querySelector('.group-copy strong')?.textContent?.trim() ?? null,
            covers: group.querySelectorAll('img').length,
            tracks: group.querySelectorAll('.track').length
          })),
          pulse: document.querySelectorAll('.week-pulse > span').length,
          total: document.querySelector('.week-total')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
          moods: [...document.querySelectorAll('.mood-copy strong')].map((node) => node.textContent?.trim()),
          overflow: document.documentElement.scrollWidth > window.innerWidth
        }))()
      `)
      if (state.dashboard && state.groups.length === 4) break
    }

    console.log('  home:', JSON.stringify(state))
    check('Home shows the listening dashboard', state?.dashboard === true)
    check(
      'recent plays are grouped into four releases',
      state?.groups.length === 4 &&
        state.groups.every((group) => group.tracks > 0 && group.covers <= 1) &&
        state.groups.some((group) => group.title === 'Home test album one' && group.tracks === 2),
      JSON.stringify(state?.groups)
    )
    check('the weekly card shows a seven-day pulse', state?.pulse === 7, `${state?.pulse}`)
    check('the listening total is rendered', /\d/.test(state?.total ?? ''), state?.total ?? '')
    check(
      'Home offers four mood cards',
      Array.isArray(state?.moods) && state.moods.join(',') === 'Focus,Energy,Late night,Throwbacks',
      JSON.stringify(state?.moods)
    )
    check('Home does not overflow horizontally', state?.overflow === false)

    const album = await app.evaluate(
      `(async () => {
        const { api, nav } = window.__viby
        await api.history.add({
          trackId: 'home-test-direct-album',
          title: 'Home direct album test',
          artist: 'Daft Punk',
          album: 'Random Access Memories',
          durationSec: 240,
          playedAt: ${Date.now()},
          completion: 1,
          thumbnail: ${JSON.stringify(thumb)}
        })
        nav.go('library')
        await new Promise((resolve) => setTimeout(resolve, 250))
        nav.go('home')
        let group = null
        for (let i = 0; i < 50; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          group = [...document.querySelectorAll('.recent-group')].find(
            (node) => node.querySelector('.group-copy strong')?.textContent?.trim() === 'Random Access Memories'
          )
          if (group) break
        }
        group?.querySelector('.group-head')?.click()
        for (let i = 0; i < 50; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          if (nav.detail?.kind === 'album') break
        }
        return {
          groupFound: Boolean(group),
          kind: nav.detail?.kind ?? null,
          title: document.querySelector('.hero h1')?.textContent?.trim() ?? null,
          view: nav.view
        }
      })()`,
      { userGesture: true }
    )
    check(
      'clicking a release opens its album page directly',
      album.groupFound && album.kind === 'album' && album.title === 'Random Access Memories',
      JSON.stringify(album)
    )
    await app.evaluate(`window.__viby.nav.go('home'); true`)

    const mood = await app.evaluate(
      `(async () => {
        document.querySelector('.mood')?.click()
        await new Promise((resolve) => setTimeout(resolve, 400))
        return {
          view: window.__viby.nav.view,
          query: window.__viby.searchState.query,
          filter: window.__viby.searchState.filter
        }
      })()`,
      { userGesture: true }
    )
    check(
      'a mood starts a search',
      mood.view === 'search' && mood.query === 'lofi instrumental focus' && mood.filter === 'all',
      JSON.stringify(mood)
    )
  } finally {
    await app.evaluate(
      `(async () => {
        await window.__viby.api.debug?.forgetHistory(${JSON.stringify(titles)})
        window.__viby.nav.go('home')
        return true
      })()`
    )
    await sleep(250)
  }
}
