import { sleep } from './lib.mjs'

export const description = 'Lyrics: a new track resets the panel instead of inheriting the old scroll'

const A = {
  id: 'khnokW3Mw24',
  kind: 'song',
  title: 'Instant Crush (feat. Julian Casablancas)',
  subtitle: 'Daft Punk',
  artists: ['Daft Punk'],
  durationSec: 338,
  videoType: 'audio'
}

const B = {
  id: 'NIma5XOxBq0',
  kind: 'song',
  title: 'Softcore',
  subtitle: 'The Neighbourhood',
  artists: ['The Neighbourhood'],
  durationSec: 206,
  videoType: 'audio'
}

export async function run(app, check) {
  // Prime both tracks' lyrics in the renderer cache. The bug only exists when
  // the new data is available instantly and the line container is reused.
  const primed = await app.evaluate(
    `
    (async () => {
      const { player } = window.__viby
      const A = ${JSON.stringify(A)}
      const B = ${JSON.stringify(B)}

      const openPanel = () => {
        if (!document.querySelector('aside.panel')?.classList.contains('open')) {
          document.querySelector('button[aria-label="Lyrics"]')?.click()
        }
      }
      const waitForLines = async () => {
        for (let i = 0; i < 40; i++) {
          if (document.querySelector('.line') && !document.querySelector('.status')) return true
          await new Promise((r) => setTimeout(r, 250))
        }
        return false
      }

      await player.playList([A, B], 0)
      for (let i = 0; i < 30 && !player.playing; i++) await new Promise((r) => setTimeout(r, 250))
      openPanel()
      const a = await waitForLines()

      await player.playList([A, B], 1)
      await new Promise((r) => setTimeout(r, 1800))
      openPanel()
      const b = await waitForLines()

      return { a, b, index: player.index, title: player.current?.title }
    })()
  `,
    { userGesture: true }
  )
  check('both tracks have synced lyrics', primed.a && primed.b, JSON.stringify(primed))

  // Play A from the start (its lyrics are now cached), then jump near the end
  // so the panel is scrolled deep into the song.
  const before = await app.evaluate(
    `
    (async () => {
      const { player } = window.__viby
      await player.playList([${JSON.stringify(A)}, ${JSON.stringify(B)}], 0)
      for (let i = 0; i < 30 && player.index !== 0; i++) await new Promise((r) => setTimeout(r, 250))
      await new Promise((r) => setTimeout(r, 1400))

      player.seek(Math.max(1, player.duration - 5))
      await new Promise((r) => setTimeout(r, 1400))

      const list = document.querySelector('.lines')
      return {
        index: player.index,
        scrollTop: Math.round(list?.scrollTop ?? -1),
        lines: document.querySelectorAll('.line').length
      }
    })()
  `,
    { userGesture: true }
  )
  check('the previous track is scrolled deep into its lyrics', before.scrollTop > 80, JSON.stringify(before))

  // Auto-advance. Sample immediately: the reset must be animated, so the panel
  // should still be deep at first, then settle at the top.
  const after = await app.evaluate(
    `
    (async () => {
      const { player } = window.__viby
      const started = performance.now()
      while (player.index !== 1 && performance.now() - started < 15000) {
        await new Promise((r) => setTimeout(r, 60))
      }
      const advancedAt = performance.now()
      const list = document.querySelector('.lines')
      return {
        index: player.index,
        title: player.current?.title ?? null,
        scrollTop: Math.round(list?.scrollTop ?? -1),
        lines: document.querySelectorAll('.line').length,
        advancedMs: Math.round(advancedAt - started)
      }
    })()
  `,
    { userGesture: true }
  )
  console.log('  after advance:', JSON.stringify(after))
  check('playback advanced to the second track', after.index === 1 && after.title === B.title, JSON.stringify(after))
  check('the reset starts as an animation, not a teleport', after.scrollTop > 60, `${after.scrollTop}px`)

  const settled = await app.evaluate(`
    (async () => {
      const list = document.querySelector('.lines')
      const started = performance.now()
      let top = list?.scrollTop ?? -1
      while (performance.now() - started < 2500) {
        await new Promise((r) => setTimeout(r, 50))
        top = list?.scrollTop ?? -1
        if (top >= 0 && top < 20) break
      }
      return { scrollTop: Math.round(top), ms: Math.round(performance.now() - started) }
    })()
  `)
  check('the animation settles at the top', settled.scrollTop >= 0 && settled.scrollTop < 20, JSON.stringify(settled))

  await app.evaluate(`document.querySelector('aside.panel .close')?.click(); true`, {
    userGesture: true
  })
  await sleep(400)
}
