export const description = 'Library: playlists appear, open, and delete cleanly'

export async function run(app, check) {
  const created = await app.evaluate(`
    (async () => {
      const { api, nav } = window.__viby
      const playlist = await api.library.createPlaylist('UI test playlist')
      await api.library.addToPlaylist(playlist.id, {
        id: 'khnokW3Mw24', title: 'Instant Crush', artist: 'Daft Punk',
        artistId: 'UCRr1xG_2WIDs18a6cIiCxeA', durationSec: 338
      })
      nav.go('library')
      await new Promise((r) => setTimeout(r, 900))
      return {
        tiles: [...document.querySelectorAll('.tile-title')].map((t) => t.textContent?.trim()),
        id: playlist.id
      }
    })()
  `)
  check('library lists the playlist', created.tiles.includes('UI test playlist'), JSON.stringify(created.tiles))

  const opened = await app.evaluate(`
    (async () => {
      const tile = [...document.querySelectorAll('.tile')].find((t) => t.textContent?.includes('UI test playlist'))
      tile?.click()
      await new Promise((r) => setTimeout(r, 900))
      return {
        title: document.querySelector('.hero h1')?.textContent?.trim() ?? null,
        rows: document.querySelectorAll('.tracks .row').length
      }
    })()
  `)
  check('playlist page opens', opened.title === 'UI test playlist', JSON.stringify(opened))
  check('playlist page lists its track', opened.rows === 1, `${opened.rows} rows`)

  const cleaned = await app.evaluate(`
    (async () => {
      const { api } = window.__viby
      const list = await api.library.playlists()
      for (const playlist of list.filter((p) => p.name === 'UI test playlist')) {
        await api.library.deletePlaylist(playlist.id)
      }
      return (await api.library.playlists()).length
    })()
  `)
  check('playlist deleted cleanly', typeof cleaned === 'number', `${cleaned} remain`)
}
