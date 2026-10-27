export const description =
  'Keyboard: Space and transport shortcuts, typing guards, Escape and / search'

export async function run(app, check) {
  const setup = await app.evaluate(
    `(async () => {
      const { api, player, sidePanel } = window.__viby
      sidePanel.close()
      const res = await api.catalog.search('daft punk', 'songs')
      const songs = res.ok ? res.data.filter((item) => item.kind === 'song').slice(0, 3) : []
      if (songs.length < 2) return { error: 'not enough songs' }
      const settings = await api.settings.get()
      // Transport checks need a real "next"; the user's repeat-one would restart.
      await api.settings.set({ shuffle: false, repeat: 'off' })
      player.applySettings(await api.settings.get())
      player.clearQueue()
      await player.playList(songs, 0)
      for (let i = 0; i < 60; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        if (player.playing) break
      }
      return {
        playing: player.playing,
        index: player.index,
        length: player.queue.length,
        title: player.current?.title ?? null,
        shuffle: settings.shuffle,
        repeat: settings.repeat
      }
    })()`,
    { userGesture: true }
  )
  check(
    'a queue is playing for the shortcut checks',
    !setup.error && setup.playing === true && setup.length >= 2,
    JSON.stringify(setup)
  )
  if (setup.error) return

  const state = () =>
    app.evaluate(`(() => {
      const p = window.__viby.player
      return {
        playing: p.playing,
        index: p.index,
        position: Math.round(p.position),
        volume: Math.round(p.volume * 100),
        muted: p.muted,
        shuffle: p.shuffle,
        repeat: p.repeat,
        id: p.current?.id ?? null,
        panel: window.__viby.sidePanel.mode
      }
    })()`)

  const press = (init) =>
    app.evaluate(`(() => {
      const event = new KeyboardEvent('keydown', ${JSON.stringify({
        bubbles: true,
        cancelable: true,
        ...init
      })})
      window.dispatchEvent(event)
      return event.defaultPrevented
    })()`)

  let now = await state()
  check('Space pauses', (await press({ code: 'Space', key: ' ' })) === true)
  await new Promise((r) => setTimeout(r, 400))
  now = await state()
  check('Space paused playback', now.playing === false, JSON.stringify(now))
  await press({ code: 'Space', key: ' ' })
  await new Promise((r) => setTimeout(r, 1200))
  now = await state()
  check('Space resumes playback', now.playing === true, JSON.stringify(now))

  const startIndex = now.index
  await press({ key: 'ArrowRight', ctrlKey: true })
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 200))
    now = await state()
    if (now.index !== startIndex) break
  }
  check('Ctrl+Right goes to the next track', now.index === startIndex + 1, `${startIndex} → ${now.index}`)
  await app.evaluate(`window.__viby.player.seek(0); true`)
  await press({ key: 'ArrowLeft', ctrlKey: true })
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 200))
    now = await state()
    if (now.index === startIndex) break
  }
  check('Ctrl+Left goes back', now.index === startIndex, `${startIndex} vs ${now.index}`)

  now = await state()
  const beforeSeek = now.position
  await press({ key: 'ArrowRight' })
  await new Promise((r) => setTimeout(r, 300))
  now = await state()
  check('Right arrow seeks forward', now.position >= beforeSeek + 4, `${beforeSeek}s → ${now.position}s`)

  now = await state()
  const beforeVolume = now.volume
  await press({ key: 'ArrowUp', ctrlKey: true })
  await new Promise((r) => setTimeout(r, 300))
  now = await state()
  check('Ctrl+Up raises the volume', now.volume >= Math.min(100, beforeVolume + 4), `${beforeVolume} → ${now.volume}`)

  await press({ key: 'm' })
  await new Promise((r) => setTimeout(r, 200))
  now = await state()
  check('M mutes', now.muted === true)
  await press({ key: 'm' })
  await new Promise((r) => setTimeout(r, 200))
  now = await state()
  check('M unmutes', now.muted === false)

  await press({ key: 's' })
  await new Promise((r) => setTimeout(r, 200))
  now = await state()
  check('S toggles shuffle', now.shuffle === !setup.shuffle, JSON.stringify(now))
  await press({ key: 's' })

  await press({ key: 'r' })
  await new Promise((r) => setTimeout(r, 200))
  now = await state()
  check('R cycles repeat', now.repeat !== setup.repeat, `${setup.repeat} → ${now.repeat}`)

  now = await state()
  const currentId = now.id
  await press({ key: 'l' })
  await new Promise((r) => setTimeout(r, 400))
  const liked = await app.evaluate(
    `(async () => (await window.__viby.api.favorites.list()).some((track) => track.id === ${JSON.stringify(currentId)}))()`
  )
  check('L likes the current track', liked === true, String(currentId))
  await press({ key: 'l' })
  await new Promise((r) => setTimeout(r, 400))
  const unliked = await app.evaluate(
    `(async () => !(await window.__viby.api.favorites.list()).some((track) => track.id === ${JSON.stringify(currentId)}))()`
  )
  check('L unlikes it again', unliked === true)

  await app.evaluate(`window.__viby.sidePanel.toggle('queue'); true`)
  await new Promise((r) => setTimeout(r, 300))
  await press({ key: 'Escape' })
  await new Promise((r) => setTimeout(r, 300))
  now = await state()
  check('Escape closes the side panel', now.panel === null, String(now.panel))

  // Typing guards: Space in the search field must not pause playback.
  const focused = await app.evaluate(`(async () => {
    document.activeElement?.blur()
    const input = document.querySelector('.searchbox input')
    input?.focus()
    await new Promise((resolve) => setTimeout(resolve, 100))
    return document.activeElement === input
  })()`)
  const playingBefore = (await state()).playing
  await app.evaluate(`(() => {
    const input = document.querySelector('.searchbox input')
    const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })
    input?.dispatchEvent(event)
    return true
  })()`)
  await new Promise((r) => setTimeout(r, 300))
  const playingAfter = (await state()).playing
  check('Space in a text field does not control playback', focused && playingAfter === playingBefore)

  const slash = await app.evaluate(`(async () => {
    document.activeElement?.blur()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 200))
    return document.activeElement === document.querySelector('.searchbox input')
  })()`)
  check('/ focuses search', slash === true)

  // Restore the toggles this scenario changed.
  await app.evaluate(
    `(async () => {
      const { api, player, sidePanel, nav } = window.__viby
      await api.settings.set({ shuffle: ${JSON.stringify(setup.shuffle)}, repeat: ${JSON.stringify(setup.repeat)} })
      player.applySettings(await api.settings.get())
      player.clearQueue()
      sidePanel.close()
      document.activeElement?.blur()
      nav.go('home')
      return true
    })()`
  )
}
