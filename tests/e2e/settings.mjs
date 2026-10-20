import { sleep } from './lib.mjs'

export const description = 'Settings: open from the sidebar, quality/cap/autoplay persist'

export async function run(app, check) {
  const original = await app.evaluate('window.__viby.api.settings.get()')

  const opened = await app.evaluate(
    `
    (async () => {
      const item = [...document.querySelectorAll('.nav')].find((b) =>
        b.textContent?.includes('Settings')
      )
      item?.click()
      await new Promise((r) => setTimeout(r, 700))
      return {
        heading: document.querySelector('.content h1')?.textContent?.trim() ?? null,
        active: item?.classList.contains('on') ?? false,
        rows: document.querySelectorAll('section .row').length
      }
    })()
  `,
    { userGesture: true }
  )
  check('sidebar opens Settings', opened.heading === 'Settings' && opened.active, JSON.stringify(opened))
  check('settings rows render', opened.rows >= 4, `${opened.rows} rows`)

  try {
    const quality = await app.evaluate(
      `
      (async () => {
        const button = [...document.querySelectorAll('.segmented button')].find(
          (b) => b.textContent?.trim() === 'Data saver'
        )
        button?.click()
        await new Promise((r) => setTimeout(r, 450))
        return {
          on: button?.classList.contains('on') ?? false,
          value: (await window.__viby.api.settings.get()).audioQuality
        }
      })()
    `,
      { userGesture: true }
    )
    check('data saver can be selected', quality.on === true && quality.value === 'data-saver', JSON.stringify(quality))

    const autoplay = await app.evaluate(
      `
      (async () => {
        const before = (await window.__viby.api.settings.get()).autoplay
        document.querySelector('.switch')?.click()
        await new Promise((r) => setTimeout(r, 400))
        return {
          before,
          after: (await window.__viby.api.settings.get()).autoplay,
          player: window.__viby.player.autoplay
        }
      })()
    `,
      { userGesture: true }
    )
    check('autoplay toggle persists', autoplay.after !== autoplay.before, JSON.stringify(autoplay))
    check('player adopts autoplay immediately', autoplay.player === autoplay.after, JSON.stringify(autoplay))

    const cap = await app.evaluate(
      `
      (async () => {
        const button = [...document.querySelectorAll('.segmented button')].find(
          (b) => b.textContent?.trim() === '2 GB'
        )
        button?.click()
        await new Promise((r) => setTimeout(r, 450))
        return (await window.__viby.api.settings.get()).cacheCapBytes
      })()
    `,
      { userGesture: true }
    )
    check('cache cap updates', cap === 2 * 1024 ** 3, `${cap} bytes`)

    // Clearing the cache is destructive, so only assert the control is wired.
    const clear = await app.evaluate(`
      (() => {
        const buttons = [...document.querySelectorAll('.row .ghost')]
        const clear = buttons.find((b) => b.textContent?.trim() === 'Clear')
        return { present: Boolean(clear), disabled: clear?.disabled ?? null }
      })()
    `)
    check('clear-cache control is present', clear.present === true, JSON.stringify(clear))
  } finally {
    // Put the user's preferences back even if a check threw.
    await app.evaluate(
      `
      (async () => {
        const next = await window.__viby.api.settings.set({
          audioQuality: ${JSON.stringify(original.audioQuality)},
          autoplay: ${JSON.stringify(original.autoplay)},
          cacheCapBytes: ${JSON.stringify(original.cacheCapBytes)}
        })
        window.__viby.player.applySettings(next)
        return true
      })()
    `)
    await sleep(200)
  }
}
