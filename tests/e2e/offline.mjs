import { sleep } from './lib.mjs'

export const description = 'Offline: manual mode shows the local-first Home and gated navigation'

/**
 * Deterministic offline coverage using the manual switch, so it never depends
 * on the machine's real network. Downloads that need yt-dlp are covered by the
 * unit suites and the manual smoke pass.
 */
export async function run(app, check) {
  const original = app.settings.offlineMode ?? 'auto'

  try {
    const offline = await app.evaluate(
      `
      (async () => {
        const { api, nav } = window.__viby
        await api.network.setMode('offline')
        nav.go('home')
        await new Promise((r) => setTimeout(r, 700))
        const navButton = (label) =>
          [...document.querySelectorAll('.nav')].find((b) => b.textContent?.trim().includes(label))
        const pill = document.querySelector('.net-pill')
        const home = document.querySelector('.content h1')?.textContent?.trim() ?? null
        return {
          state: await api.network.get(),
          pill: pill?.textContent?.trim() ?? null,
          home,
          eyebrow: document.querySelector('.content .status, .content .eyebrow')?.textContent?.trim() ?? null,
          chartsDisabled: navButton('Charts')?.disabled ?? null,
          importDisabled: navButton('Import')?.disabled ?? null,
          libraryPresent: Boolean(navButton('Library')),
          downloadsPresent: Boolean(navButton('Downloads')),
          notice: document.querySelector('.content .notice')?.textContent?.trim() ?? null
        }
      })()
    `,
      { userGesture: true }
    )

    check('manual mode is reported', offline.state?.forcedOffline === true, JSON.stringify(offline.state))
    check('titlebar shows the offline pill', Boolean(offline.pill), String(offline.pill))
    check('offline Home replaces Home', offline.home === 'Ready when you are.', String(offline.home))
    check('Charts is disabled offline', offline.chartsDisabled === true, String(offline.chartsDisabled))
    check('Import is disabled offline', offline.importDisabled === true, String(offline.importDisabled))
    check('Library stays available', offline.libraryPresent === true)
    check('the separate Downloads page is gone', offline.downloadsPresent === false)
    check('no error banner on offline Home', offline.notice === null, String(offline.notice))

    const snapshot = await app.evaluate(
      `(async () => {
        const s = await window.__viby.api.downloads.snapshot()
        return {
          entries: Array.isArray(s.entries),
          collections: Array.isArray(s.collections),
          jobs: Array.isArray(s.jobs),
          stats: typeof s.stats?.bytes === 'number'
        }
      })()`
    )
    check('downloads snapshot is well formed', Object.values(snapshot).every(Boolean), JSON.stringify(snapshot))

    const library = await app.evaluate(
      `
      (async () => {
        const item = [...document.querySelectorAll('.nav')].find((b) =>
          b.textContent?.trim().includes('Library')
        )
        item?.click()
        await new Promise((r) => setTimeout(r, 900))
        const chips = [...document.querySelectorAll('.filters .chip')].map((chip) =>
          chip.textContent?.trim()
        )
        return {
          title: document.querySelector('.content h1')?.textContent?.trim() ?? null,
          chips,
          badgeCount: document.querySelectorAll('.badge').length
        }
      })()
    `,
      { userGesture: true }
    )
    check('Library opens offline', library.title === 'Library', String(library.title))
    check(
      'Library offers Spotify-style filters',
      ['All', 'Playlists', 'Albums', 'Downloaded'].every((label) => library.chips?.includes(label)),
      JSON.stringify(library.chips)
    )
    check('badges render without a crash', typeof library.badgeCount === 'number', String(library.badgeCount))

    const online = await app.evaluate(
      `
      (async () => {
        const { api, nav } = window.__viby
        await api.network.setMode('auto')
        nav.go('home')
        // Reconnecting runs a real probe (up to a few seconds); wait for the
        // connected layout instead of assuming a fixed delay.
        let state = await api.network.get()
        for (let i = 0; i < 40 && state.status !== 'online'; i++) {
          await new Promise((r) => setTimeout(r, 250))
          state = await api.network.get()
        }
        await new Promise((r) => setTimeout(r, 200))
        const navButton = (label) =>
          [...document.querySelectorAll('.nav')].find((b) => b.textContent?.trim().includes(label))
        return {
          state,
          home: document.querySelector('.content h1')?.textContent?.trim() ?? null,
          pill: Boolean(document.querySelector('.net-pill')),
          chartsDisabled: navButton('Charts')?.disabled ?? null
        }
      })()
    `,
      { userGesture: true }
    )
    check('auto mode clears the manual flag', online.state?.forcedOffline === false, JSON.stringify(online.state))
    check('normal Home returns', online.home === 'Home', String(online.home))
    check('offline pill is gone when connected', online.pill === false)
    check('Charts is enabled again', online.chartsDisabled === false, String(online.chartsDisabled))
  } finally {
    await app.evaluate(
      `(async () => {
        const { api, nav } = window.__viby
        await api.network.setMode(${JSON.stringify(original)})
        // Leave the app connected before the next scenario runs.
        let state = await api.network.get()
        for (let i = 0; i < 40 && state.forcedOffline; i++) {
          await new Promise((r) => setTimeout(r, 250))
          state = await api.network.get()
        }
        for (let i = 0; i < 40 && state.status !== 'online' && !state.forcedOffline; i++) {
          await new Promise((r) => setTimeout(r, 250))
          state = await api.network.get()
        }
        nav.go('home')
        return true
      })()`
    )
    await sleep(300)
  }
}
