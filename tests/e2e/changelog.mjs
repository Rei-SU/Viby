import { sleep } from './lib.mjs'

export const description =
  "What's New: notes for a new version appear once, and can be reopened from Settings"

export async function run(app, check) {
  const before = await app.evaluate('window.__viby.api.settings.get()')

  try {
    const shown = await app.evaluate(
      `
      (async () => {
        const api = window.__viby.api
        await api.settings.set({ lastSeenVersion: '0.2.3' })
        await window.__viby.changelog.refresh()
        await new Promise((r) => setTimeout(r, 900))
        const sheet = document.querySelector('[role="dialog"][aria-modal="true"]')
        return {
          open: !!sheet,
          title: sheet?.querySelector('h2')?.textContent?.trim() ?? null,
          released: sheet?.querySelector('.released')?.textContent?.trim() ?? null,
          bullets: sheet?.querySelectorAll('li').length ?? 0,
          first: sheet?.querySelector('li')?.textContent?.trim() ?? null,
          sections: sheet?.querySelectorAll('.section-title').length ?? 0,
          notes: sheet?.querySelector('a.notes')?.getAttribute('href') ?? null,
          seen: (await api.settings.get()).lastSeenVersion
        }
      })()
    `,
      { userGesture: true }
    )

    check('the sheet opens after an update', shown.open === true, JSON.stringify(shown))
    check('it names the new version', shown.title === 'Viby 0.2.4', shown.title)
    check('it shows when the version was released', /^Released \S/.test(shown.released ?? ''), shown.released)
    check('it lists the release notes', shown.bullets >= 3, `${shown.bullets} bullets`)
    check('the notes are the real ones', /taskbar/i.test(shown.first ?? ''), shown.first)
    check('sections are labelled when there are several', shown.sections === 2, String(shown.sections))
    check(
      'Full notes points at the release',
      shown.notes?.endsWith('/releases/tag/v0.2.4') === true,
      shown.notes
    )
    check('opening alone does not mark it seen', shown.seen === '0.2.3', shown.seen)

    const closed = await app.evaluate(
      `
      (async () => {
        document.querySelector('[role="dialog"] .done')?.click()
        await new Promise((r) => setTimeout(r, 400))
        return {
          open: !!document.querySelector('[role="dialog"][aria-modal="true"]'),
          seen: (await window.__viby.api.settings.get()).lastSeenVersion
        }
      })()
    `,
      { userGesture: true }
    )
    check('closing dismisses the sheet', closed.open === false)
    check('closing records the version as seen', closed.seen === '0.2.4', closed.seen)

    const again = await app.evaluate(`
      (async () => {
        await window.__viby.changelog.refresh()
        await new Promise((r) => setTimeout(r, 900))
        return !!document.querySelector('[role="dialog"][aria-modal="true"]')
      })()
    `)
    check('it does not reopen for the same version', again === false)

    const multi = await app.evaluate(
      `
      (async () => {
        await window.__viby.api.settings.set({ lastSeenVersion: '0.1.2' })
        await window.__viby.changelog.refresh()
        await new Promise((r) => setTimeout(r, 900))
        const sheet = document.querySelector('[role="dialog"][aria-modal="true"]')
        return {
          open: !!sheet,
          releases: sheet?.querySelectorAll('.release').length ?? 0,
          earlier: sheet?.querySelector('.earlier')?.textContent?.trim() ?? null
        }
      })()
    `,
      { userGesture: true }
    )
    check('a multi-version jump still fits the sheet', multi.open === true && multi.releases === 3, JSON.stringify(multi))
    check('it counts the updates it left out', multi.earlier === 'And 2 earlier updates.', multi.earlier)

    await app.evaluate(
      `(async () => {
        document.querySelector('[role="dialog"] .done')?.click()
        await new Promise((r) => setTimeout(r, 400))
        return true
      })()`,
      { userGesture: true }
    )

    const reopened = await app.evaluate(
      `
      (async () => {
        window.__viby.nav.go('settings')
        await new Promise((r) => setTimeout(r, 600))
        const button = [...document.querySelectorAll('button')].find(
          (b) => b.textContent?.trim() === 'View notes'
        )
        button?.click()
        await new Promise((r) => setTimeout(r, 300))
        const sheet = document.querySelector('[role="dialog"][aria-modal="true"]')
        return {
          found: !!button,
          open: !!sheet,
          title: sheet?.querySelector('h2')?.textContent?.trim() ?? null
        }
      })()
    `,
      { userGesture: true }
    )
    check('Settings offers the running version notes', reopened.found === true)
    check('Settings reopens the same sheet', reopened.open === true && reopened.title === 'Viby 0.2.4', JSON.stringify(reopened))

    const escaped = await app.evaluate(
      `
      (async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await new Promise((r) => setTimeout(r, 250))
        return !!document.querySelector('[role="dialog"][aria-modal="true"]')
      })()
    `,
      { userGesture: true }
    )
    check('Escape closes it', escaped === false)
  } finally {
    await app.evaluate(
      `(async () => {
        await window.__viby.api.settings.set({ lastSeenVersion: ${JSON.stringify(before.lastSeenVersion)} })
        await window.__viby.changelog.refresh()
        await new Promise((r) => setTimeout(r, 600))
        return true
      })()`
    )
    await sleep(100)
  }
}
