import { sleep } from './lib.mjs'

export const description = 'Import: paste a Spotify link, match, review and create a playlist'

export async function run(app, check) {
  const existing = await app.evaluate(`window.__viby.api.library.playlists().then((list) => list.map((p) => p.id))`)
  let created = null

  try {
    await app.evaluate(`window.__viby.nav.go('import'); true`, { userGesture: true })
    await sleep(500)

    const submitted = await app.evaluate(
      `(() => {
        const input = document.querySelector('.url input')
        if (!input) return null
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(input, 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector('.url')?.requestSubmit()
        return input.value
      })()`,
      { userGesture: true }
    )
    check('submits the playlist link', typeof submitted === 'string' && submitted.includes('spotify.com'), String(submitted))

    let state = null
    for (let i = 0; i < 160; i++) {
      await sleep(500)
      state = await app.evaluate(`
        ({
          rows: document.querySelectorAll('.rows .row').length,
          source: document.querySelector('.source h2')?.textContent?.trim() ?? null,
          counts: document.querySelector('.counts')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
          error: document.querySelector('.error')?.textContent?.trim() ?? null,
          matching: Boolean(document.querySelector('.matching'))
        })
      `)
      if (state.rows > 0 || state.error) break
    }

    console.log('  match:', JSON.stringify(state))
    check('resolves the source playlist', state?.source === 'Today’s Top Hits', state?.source ?? 'null')
    check('matches the tracks', (state?.rows ?? 0) > 0, `${state?.rows ?? 0} rows`)
    check('reports match counts', /matched/.test(state?.counts ?? '') && !/^0 matched/.test(state?.counts ?? ''), state?.counts ?? '')
    check('no error while matching', !state?.error, state?.error ?? '')

    const sourceFirst = await app.evaluate(
      `document.querySelector('.rows .row .title')?.textContent?.trim() ?? null`
    )
    check('shows the source in playlist order', sourceFirst === 'expectations (feat. Chappell Roan)', sourceFirst ?? 'null')

    const clicked = await app.evaluate(
      `(() => {
        const button = document.querySelector('.summary-actions .primary')
        if (!button || button.disabled) return false
        button.click()
        return true
      })()`,
      { userGesture: true }
    )
    check('import action is available above the list', clicked === true)

    let done = null
    for (let i = 0; i < 80; i++) {
      await sleep(500)
      done = await app.evaluate(`
        ({
          heading: document.querySelector('.done h2')?.textContent?.trim() ?? null,
          error: document.querySelector('.error')?.textContent?.trim() ?? null
        })
      `)
      if (done.heading || done.error) break
    }
    check('creates the playlist', done?.heading === 'Today’s Top Hits', done?.heading ?? done?.error ?? 'null')

    created = await app.evaluate(`
      (async () => {
        const list = await window.__viby.api.library.playlists()
        const before = new Set(${JSON.stringify(existing)})
        const playlist = list.find((entry) => !before.has(entry.id))
        return playlist
          ? {
              id: playlist.id,
              name: playlist.name,
              tracks: playlist.tracks.length,
              first: playlist.tracks[0]?.title ?? null,
              last: playlist.tracks.at(-1)?.title ?? null
            }
          : null
      })()
    `)
    console.log('  created:', JSON.stringify(created))
    check('playlist is in the library', Boolean(created), created ? 'yes' : 'missing')
    check('playlist has the matched tracks', (created?.tracks ?? 0) > 0, `${created?.tracks ?? 0}`)
    check('playlist keeps source order', created?.first === 'expectations', created?.first ?? 'null')
  } finally {
    const ids = await app.evaluate(`window.__viby.api.library.playlists().then((list) => list.map((p) => p.id))`).catch(() => [])
    for (const id of ids ?? []) {
      if (!existing.includes(id)) {
        await app.evaluate(`window.__viby.api.library.deletePlaylist(${JSON.stringify(id)})`).catch(() => undefined)
      }
    }
    console.log('  cleanup: removed test playlists')
  }
}
