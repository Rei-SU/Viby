import { sleep } from './lib.mjs'

export const description = 'Lyrics panel: open, synced lines, click-to-seek, close'

export async function run(app, check) {
  await app.evaluate(
    `
    (async () => {
      const p = window.__viby.player
      await p.playList([{
        id: 'khnokW3Mw24', kind: 'song',
        title: 'Instant Crush (feat. Julian Casablancas)',
        subtitle: 'Daft Punk', artists: ['Daft Punk'], durationSec: 338,
        videoType: 'audio'
      }], 0)
      for (let i = 0; i < 16 && !p.playing; i++) await new Promise((r) => setTimeout(r, 500))
      p.seek(60)
      return true
    })()
  `,
    { userGesture: true }
  )
  await sleep(1200)

  // The panel can be left open by a previous interaction.
  await app.evaluate(`document.querySelector('.panel .close')?.click(); true`, { userGesture: true })
  await sleep(400)
  await app.evaluate(`document.querySelector('button[aria-label="Lyrics"]')?.click(); true`, {
    userGesture: true
  })
  await sleep(2400)

  const state = await app.evaluate(`
    (() => {
      const panel = document.querySelector('aside.panel')
      return {
        open: panel?.classList.contains('open') ?? false,
        lines: document.querySelectorAll('.line').length,
        active: document.querySelectorAll('.line.active').length,
        source: document.querySelector('.panel .source')?.textContent?.trim() ?? null
      }
    })()
  `)
  console.log('  ', JSON.stringify(state))
  check('lyrics panel opens', state.open === true, JSON.stringify(state))
  check('lyrics are synced with one active line', state.lines > 0 && state.active === 1, JSON.stringify(state))

  const seeked = await app.evaluate(
    `
    (async () => {
      document.querySelectorAll('.line')[2]?.click()
      await new Promise((r) => setTimeout(r, 800))
      return Math.round(window.__viby.player.position)
    })()
  `,
    { userGesture: true }
  )
  check('clicking a lyric seeks', seeked > 0, `${seeked}s`)

  await app.evaluate(`document.querySelector('.panel .close')?.click(); true`, { userGesture: true })
  await sleep(700)
  const closed = await app.evaluate(
    `!document.querySelector('aside.panel')?.classList.contains('open')`
  )
  check('lyrics panel closes', closed === true)
}
