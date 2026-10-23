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
  const closedWidth = await app.evaluate(
    `Math.round(document.querySelector('main.content')?.getBoundingClientRect().width ?? 0)`
  )
  await app.evaluate(`document.querySelector('button[aria-label="Lyrics"]')?.click(); true`, {
    userGesture: true
  })
  await sleep(2400)

  const state = await app.evaluate(`
    (() => {
      const main = document.querySelector('main.content')
      const panel = document.querySelector('aside.panel')
      const mainRect = main?.getBoundingClientRect()
      const panelRect = panel?.getBoundingClientRect()
      return {
        open: panel?.classList.contains('open') ?? false,
        lines: document.querySelectorAll('.line').length,
        active: document.querySelectorAll('.line.active').length,
        source: document.querySelector('.panel .source')?.textContent?.trim() ?? null,
        mainWidth: Math.round(mainRect?.width ?? 0),
        mainRight: Math.round(mainRect?.right ?? 0),
        panelLeft: Math.round(panelRect?.left ?? 0),
        panelWidth: Math.round(panelRect?.width ?? 0)
      }
    })()
  `)
  console.log('  ', JSON.stringify(state))
  check('lyrics panel opens', state.open === true, JSON.stringify(state))
  check('lyrics are synced with one active line', state.lines > 0 && state.active === 1, JSON.stringify(state))
  check(
    'lyrics dock instead of covering the page',
    state.mainWidth < closedWidth && state.panelLeft >= state.mainRight - 1,
    JSON.stringify({ closedWidth, ...state })
  )
  check('lyrics sidebar has usable width', state.panelWidth >= 300, `${state.panelWidth}px`)

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
  const restoredWidth = await app.evaluate(
    `Math.round(document.querySelector('main.content')?.getBoundingClientRect().width ?? 0)`
  )
  check('lyrics panel closes', closed === true)
  check(
    'closing lyrics restores the page width',
    Math.abs(restoredWidth - closedWidth) <= 1,
    `${restoredWidth}px vs ${closedWidth}px`
  )
}
