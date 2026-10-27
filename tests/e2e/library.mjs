export const description = 'Library: playlists and saved releases appear, open, and delete cleanly'

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

  // ---- saved releases -------------------------------------------------------
  const setup = await app.evaluate(`(async () => {
    const { api } = window.__viby
    const res = await api.catalog.search('random access memories', 'albums')
    const album = res.ok
      ? res.data.find((item) => item.kind === 'album' && (item.browseId || item.id))
      : null
    if (!album) return { found: false }
    const id = album.browseId ?? album.id
    const existing = (await api.library.albums()).find((entry) => entry.id === id)
    if (existing) await api.library.toggleAlbum(existing)
    window.__vibyAlbumTest = album
    return { found: true, id, title: album.title, wasSaved: Boolean(existing) }
  })()`)
  if (!setup.found) {
    check('an album is available to save', false, 'search returned nothing')
  } else {
    const saved = await app.evaluate(`
      (async () => {
        const { api, nav } = window.__viby
        nav.open(window.__vibyAlbumTest)
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 150))
          if (document.querySelector('.save-album')) break
        }
        const button = document.querySelector('.save-album')
        const before = button?.textContent?.trim() ?? null
        button?.click()
        await new Promise((r) => setTimeout(r, 500))
        const entry = (await api.library.albums()).find((a) => a.id === ${JSON.stringify(setup.id)})
        const after = document.querySelector('.save-album')?.textContent?.trim() ?? null
        nav.go('library')
        await new Promise((r) => setTimeout(r, 900))
        const tile = [...document.querySelectorAll('.tile')].find((t) =>
          t.textContent?.includes(${JSON.stringify(setup.title)})
        )
        return {
          before,
          after,
          saved: Boolean(entry),
          label: entry?.releaseType ?? null,
          tile: Boolean(tile),
          subtitle: tile?.querySelector('.tile-sub')?.textContent?.trim() ?? null
        }
      })()
    `, { userGesture: true })
    check(
      'an album can be saved from its page',
      saved.before === 'Save' && saved.after === 'Saved' && saved.saved === true,
      JSON.stringify(saved)
    )
    check(
      'the saved album appears in the library',
      saved.tile === true && /^Album · \d+ songs?$/.test(saved.subtitle ?? ''),
      JSON.stringify(saved)
    )

    const off = await app.evaluate(`
      (async () => {
        const { api, nav } = window.__viby
        const tile = [...document.querySelectorAll('.tile')].find((t) =>
          t.textContent?.includes(${JSON.stringify(setup.title)})
        )
        tile?.click()
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 150))
          if (document.querySelector('.save-album')) break
        }
        const label = document.querySelector('.save-album')?.textContent?.trim() ?? null
        document.querySelector('.save-album')?.click()
        await new Promise((r) => setTimeout(r, 500))
        return {
          label,
          removed: !(await api.library.albums()).some((a) => a.id === ${JSON.stringify(setup.id)}),
          heading: document.querySelector('.hero h1')?.textContent?.trim() ?? null
        }
      })()
    `, { userGesture: true })
    check(
      'the tile reopens the album and Saved toggles it off',
      off.heading === setup.title && off.label === 'Saved' && off.removed === true,
      JSON.stringify(off)
    )

    // Restore the user's library if this album was saved before the test.
    await app.evaluate(`
      (async () => {
        if (${setup.wasSaved}) {
          await window.__viby.api.library.toggleAlbum({
            id: ${JSON.stringify(setup.id)},
            title: ${JSON.stringify(setup.title)},
            releaseType: 'Album',
            savedAt: Date.now()
          })
        }
        window.__viby.nav.go('library')
        return true
      })()
    `)
  }
}
