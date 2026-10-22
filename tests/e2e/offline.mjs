import { sleep } from './lib.mjs'

export const description = 'Offline: local-first Home, unavailable Search, gated navigation'

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

    // Search needs the catalog, so the offline page explains the missing
    // connection instead of quietly searching a partial local index. Any rows
    // left over from an online query must disappear immediately.
    const offlineSearch = await app.evaluate(
      `(async () => {
        const { searchState, nav } = window.__viby
        searchState.query = 'viby-offline-search'
        searchState.items = [
          {
            id: 'viby-cached-song',
            kind: 'song',
            title: 'Cached Only Song',
            subtitle: 'Online Artist',
            durationSec: 180
          },
          { id: 'viby-cached-artist', kind: 'artist', title: 'Cached Only Artist', subtitle: 'Artist' }
        ]
        searchState.source = 'online'
        searchState.loading = false
        searchState.error = null
        searchState.refreshSource()
        nav.go('search')
        await new Promise((r) => setTimeout(r, 250))
        const input = document.querySelector('.searchbox input')
        return {
          heading: document.querySelector('.content h1')?.textContent?.trim() ?? null,
          body:
            document.querySelector('.content .offline-page > p:not(.eyebrow)')?.textContent?.trim() ??
            null,
          rows: document.querySelectorAll('.results .row').length,
          chips: document.querySelectorAll('.chips .chip').length,
          visible: searchState.visibleItems.length,
          source: searchState.source,
          cached: searchState.items.length,
          disabled: input?.disabled ?? null,
          placeholder: input?.getAttribute('placeholder') ?? null
        }
      })()`,
      { userGesture: true }
    )
    check(
      'offline search does not run',
      offlineSearch.heading === 'You are not connected to the internet.' &&
        offlineSearch.rows === 0 &&
        offlineSearch.chips === 0 &&
        offlineSearch.visible === 0 &&
        offlineSearch.source === null &&
        offlineSearch.cached === 0 &&
        offlineSearch.disabled === true,
      JSON.stringify(offlineSearch)
    )
    check(
      'offline search explains the connection',
      offlineSearch.body?.includes('Reconnect to search') === true &&
        offlineSearch.placeholder === 'You are not connected to the internet',
      JSON.stringify({ body: offlineSearch.body, placeholder: offlineSearch.placeholder })
    )

    // Downloaded playback and the failed-resolve retry are exercised with the
    // first explicit download when this profile has one. The pure source-action
    // regression suite covers the same rule without requiring user data.
    const playerOffline = await app.evaluate(
      `(async () => {
        const { api, player } = window.__viby
        const snap = await api.downloads.snapshot()
        const entry = snap.entries[0]
        if (!entry) return { skipped: true }

        const a = {
          id: entry.track.id,
          kind: 'song',
          title: entry.track.title,
          subtitle: entry.track.artist,
          durationSec: entry.track.durationSec,
          thumbnail: entry.artUrl ?? entry.track.thumbnail
        }
        const b = {
          id: 'viby-offline-missing-' + Date.now(),
          kind: 'song',
          title: 'Missing Offline Track',
          subtitle: 'Nobody',
          durationSec: 200
        }

        await player.playList([a], 0)
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 100))
          if (player.current?.id === a.id && player.playing && player.diagnostics.currentTime > 0) break
        }
        const selected = {
          title: player.current?.title ?? null,
          id: player.current?.id ?? null,
          queue: player.queue.map((track) => track.id),
          index: player.index,
          playing: player.playing,
          error: player.error
        }
        const primed = player.diagnostics.currentTime

        await player.playList([b], 0)
        await new Promise((r) => setTimeout(r, 300))
        const failed = {
          title: player.current?.title ?? null,
          playing: player.playing,
          position: player.diagnostics.currentTime,
          readyState: player.diagnostics.readyState,
          error: player.error
        }
        await player.playList([b], 0)
        await new Promise((r) => setTimeout(r, 300))
        const retried = {
          title: player.current?.title ?? null,
          playing: player.playing,
          position: player.diagnostics.currentTime,
          readyState: player.diagnostics.readyState,
          error: player.error
        }
        player.error = null
        player.clearQueue()
        return { skipped: false, selected, requested: entry.track.id, primed, failed, retried }
      })()`,
      { userGesture: true }
    )
    if (playerOffline.skipped) {
      check('offline player retry guard', true, 'skipped: no explicit downloads on this profile')
    } else {
      check(
        'a downloaded track still plays offline',
        playerOffline.selected.id === playerOffline.requested &&
          playerOffline.selected.queue.length === 1 &&
          playerOffline.selected.queue[0] === playerOffline.requested &&
          playerOffline.selected.index === 0 &&
          playerOffline.selected.playing === true &&
          playerOffline.selected.error === null,
        JSON.stringify(playerOffline.selected)
      )
      check(
        'a failed offline resolve clears the old audio source',
        playerOffline.primed > 0 &&
          playerOffline.failed.playing === false &&
          playerOffline.failed.position === 0 &&
          playerOffline.failed.readyState === 0 &&
          playerOffline.failed.error?.includes("isn't downloaded"),
        JSON.stringify(playerOffline.failed)
      )
      check(
        'retrying an unavailable song cannot play the previous track',
        playerOffline.retried.playing === false &&
          playerOffline.retried.position === 0 &&
          playerOffline.retried.readyState === 0 &&
          playerOffline.retried.title === 'Missing Offline Track',
        JSON.stringify(playerOffline.retried)
      )
    }

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
        await new Promise((r) => setTimeout(r, 350))
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

    const searchOnline = await app.evaluate(
      `(async () => {
        const { nav, searchState } = window.__viby
        searchState.setQuery('')
        nav.go('search')
        await new Promise((r) => setTimeout(r, 250))
        const input = document.querySelector('.searchbox input')
        return {
          heading: document.querySelector('.content h1')?.textContent?.trim() ?? null,
          offlinePage: Boolean(document.querySelector('.content .offline-page')),
          disabled: input?.disabled ?? null,
          placeholder: input?.getAttribute('placeholder') ?? null
        }
      })()`,
      { userGesture: true }
    )
    check(
      'search is available again when connected',
      searchOnline.heading === 'Search' &&
        searchOnline.offlinePage === false &&
        searchOnline.disabled === false,
      JSON.stringify(searchOnline)
    )
  } finally {
    await app.evaluate(
      `(async () => {
        const { api, nav, searchState } = window.__viby
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
        searchState.setQuery('')
        nav.go('home')
        return true
      })()`
    )
    await sleep(300)
  }
}
