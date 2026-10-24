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

  // The carousel assertion below is about Home; make the view deterministic
  // instead of inheriting whatever the previous scenario left open.
  await app.evaluate(`window.__viby.nav.go('home'); true`)
  await sleep(800)

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

  // Start each rail at its first card so the whole-card assertion measures the
  // initial layout, not a scroll position left by an earlier scenario.
  await app.evaluate(
    `[...document.querySelectorAll('.rail')].forEach((rail) => { rail.scrollLeft = 0 }); true`
  )
  await sleep(400)

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
        panelWidth: Math.round(panelRect?.width ?? 0),
        panelBorder: panel ? getComputedStyle(panel).borderLeftWidth : null,
        panelBorderStyle: panel ? getComputedStyle(panel).borderLeftStyle : null,
        panelBorderColor: panel ? getComputedStyle(panel).borderLeftColor : null,
        panelBg: panel ? getComputedStyle(panel).backgroundColor : null,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        railRights: [...document.querySelectorAll('.rail')].map((rail) =>
          Math.round(rail.getBoundingClientRect().right)
        ),
        railFit: [...document.querySelectorAll('.rail')].map((rail) => {
          const rs = getComputedStyle(rail)
          const rect = rail.getBoundingClientRect()
          const padLeft = parseFloat(rs.paddingLeft) || 0
          const padRight = parseFloat(rs.paddingRight) || 0
          const gap = parseFloat(rs.columnGap) || 0
          const cols = Number(rail.dataset.railCols) || 0
          const cards = [...rail.children].filter((el) => el.classList.contains('card'))
          const widths = cards.map((card) => card.getBoundingClientRect().width)
          const count = Math.min(cols, cards.length)
          const last = cards[count - 1]?.getBoundingClientRect()
          const next = cards[count]?.getBoundingClientRect()
          const contentLeft = rect.left + padLeft
          const contentRight = rect.right - padRight
          return {
            cols,
            cardCount: cards.length,
            cardWidth: widths[0] ?? 0,
            widthSpread: widths.length > 0 ? Math.max(...widths) - Math.min(...widths) : 0,
            gap,
            contentLeft,
            contentRight,
            contentWidth: contentRight - contentLeft,
            firstLeft: cards[0]?.getBoundingClientRect().left ?? null,
            lastRight: last?.right ?? null,
            nextLeft: next?.left ?? null,
            rowWidth: count * (widths[0] ?? 0) + Math.max(0, count - 1) * gap,
            scrollSnap: rs.scrollSnapType
          }
        })
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
  check(
    'lyrics panel has a subtle hairline divider',
    (() => {
      const alpha = /rgba?\(([^)]+)\)/.exec(state.panelBorderColor ?? '')?.[1]
        ?.split(',')
        .map((part) => Number(part.trim()))[3]
      return (
        state.panelBorder === '1px' &&
        state.panelBorderStyle === 'solid' &&
        Number.isFinite(alpha) &&
        alpha <= 0.1 &&
        state.panelBg === state.bodyBg
      )
    })(),
    JSON.stringify({
      panelBorder: state.panelBorder,
      panelBorderStyle: state.panelBorderStyle,
      panelBorderColor: state.panelBorderColor,
      panelBg: state.panelBg,
      bodyBg: state.bodyBg
    })
  )
  const railGutters = state.railRights.map((right) => state.panelLeft - right)
  check(
    'carousels stop inside the page, clear of the lyrics panel',
    state.railRights.length > 0 &&
      railGutters.every((gap) => gap >= 12) &&
      Math.max(...railGutters) - Math.min(...railGutters) <= 1,
    JSON.stringify({ railRights: state.railRights, panelLeft: state.panelLeft, railGutters })
  )
  check(
    'every carousel shows whole cards',
    state.railFit.length > 0 &&
      state.railFit.every((rail) => {
        const visible = Math.min(rail.cols, rail.cardCount)
        return (
          rail.cols >= 1 &&
          visible >= 1 &&
          rail.cardWidth > 100 &&
          rail.widthSpread <= 0.5 &&
          rail.firstLeft >= rail.contentLeft - 1 &&
          rail.lastRight <= rail.contentRight + 1 &&
          (rail.cardCount <= visible || rail.nextLeft >= rail.contentRight - 1) &&
          (rail.cardCount < rail.cols || Math.abs(rail.rowWidth - rail.contentWidth) <= 1)
        )
      }) &&
      state.railFit.every((rail) => rail.scrollSnap.includes('mandatory')),
    JSON.stringify(state.railFit)
  )

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
