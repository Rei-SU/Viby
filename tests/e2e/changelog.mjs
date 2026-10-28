import { sleep } from './lib.mjs'

export const description =
  "What's New: notes for a new version appear once, and can be reopened from Settings"

/**
 * Point the app at a baseline and read the sheet it decides to show. Both
 * stored values are set so each case is independent of the previous one.
 */
async function show(app, seen, shown) {
  return app.evaluate(
    `
    (async () => {
      const api = window.__viby.api
      await api.settings.set({
        lastSeenVersion: ${JSON.stringify(seen)},
        lastShownVersion: ${JSON.stringify(shown)}
      })
      await window.__viby.changelog.refresh()
      await new Promise((r) => setTimeout(r, 900))
      const sheet = document.querySelector('[role="dialog"][aria-modal="true"]')
      const settings = await api.settings.get()
      return {
        open: !!sheet,
        title: sheet?.querySelector('h2')?.textContent?.trim() ?? null,
        released: sheet?.querySelector('.released')?.textContent?.trim() ?? null,
        bullets: sheet?.querySelectorAll('li').length ?? 0,
        first: sheet?.querySelector('li')?.textContent?.trim() ?? null,
        sections: sheet?.querySelectorAll('.section-title').length ?? 0,
        releases: sheet?.querySelectorAll('.release').length ?? 0,
        older: [...(sheet?.querySelectorAll('.release h3 a') ?? [])].map(
          (a) => a.textContent?.trim() ?? ''
        ),
        earlier: sheet?.querySelector('.earlier')?.textContent?.trim() ?? null,
        notes: sheet?.querySelector('a.notes')?.getAttribute('href') ?? null,
        seen: settings.lastSeenVersion,
        shown: settings.lastShownVersion
      }
    })()
  `,
    { userGesture: true }
  )
}

async function close(app) {
  return app.evaluate(
    `
    (async () => {
      document.querySelector('[role="dialog"] .done')?.click()
      await new Promise((r) => setTimeout(r, 400))
      const settings = await window.__viby.api.settings.get()
      return {
        open: !!document.querySelector('[role="dialog"][aria-modal="true"]'),
        seen: settings.lastSeenVersion,
        shown: settings.lastShownVersion
      }
    })()
  `,
    { userGesture: true }
  )
}

export async function run(app, check) {
  const before = await app.evaluate('window.__viby.api.settings.get()')
  const info = await app.evaluate('window.__viby.api.app.changelog()')
  const entries = info.entries ?? []
  const current = info.version
  const newest = entries[0]
  const previous = entries[1]?.version ?? ''
  const firstItem = newest?.sections?.[0]?.items?.[0] ?? ''

  check(
    'the running version has baked notes',
    newest?.version === current,
    `${newest?.version} vs ${current}`
  )
  check('this is not a first install', info.firstRun === false, String(info.firstRun))

  if (!newest || entries.length < 6) {
    check(
      'there are enough baked releases to exercise the sheet',
      false,
      `${entries.length} entries`
    )
    return
  }

  try {
    const shown = await show(app, previous, previous)
    check('the sheet opens after an update', shown.open === true, JSON.stringify(shown))
    check('it names the new version', shown.title === `Viby ${current}`, shown.title)
    check(
      'it shows when the version was released',
      /^Released \S/.test(shown.released ?? ''),
      shown.released
    )
    check('it lists the release notes', shown.bullets >= 3, `${shown.bullets} bullets`)
    check('the notes are the real ones', shown.first === firstItem, shown.first)
    check(
      'sections are labelled when there are several',
      shown.sections === (newest.sections.length > 1 ? newest.sections.length : 0),
      `${shown.sections} vs ${newest.sections.length}`
    )
    check(
      'Full notes points at the release',
      shown.notes?.endsWith(`/releases/tag/v${current}`) === true,
      shown.notes
    )
    check(
      'opening alone does not mark it seen',
      shown.seen === previous && shown.shown === previous,
      `${shown.seen} / ${shown.shown}`
    )

    const closed = await close(app)
    check('closing dismisses the sheet', closed.open === false)
    check(
      'closing records the version as seen and shown',
      closed.seen === current && closed.shown === current,
      `${closed.seen} / ${closed.shown}`
    )

    const again = await app.evaluate(`
      (async () => {
        await window.__viby.changelog.refresh()
        await new Promise((r) => setTimeout(r, 900))
        return !!document.querySelector('[role="dialog"][aria-modal="true"]')
      })()
    `)
    check('it does not reopen for the same version', again === false)

    // The 0.5.0 regression: a build recorded the version as seen without ever
    // showing a sheet. It must be included in the next sheet, not skipped.
    const catchUp = await show(app, previous, '')
    check(
      'a version marked seen without a sheet is shown again',
      catchUp.open === true && catchUp.releases === 2,
      JSON.stringify({ open: catchUp.open, releases: catchUp.releases })
    )
    check(
      'the catch-up sheet starts with the running version',
      catchUp.title === `Viby ${current}` && catchUp.older[0] === `Viby ${previous}`,
      `${catchUp.title} / ${catchUp.older.join(', ')}`
    )
    await close(app)

    // Seen and shown the running version, but no sheet was ever painted (the
    // app quit before it appeared): show that version once, then stop.
    const unshown = await show(app, current, '')
    check(
      'the running version is shown once if no sheet was ever painted',
      unshown.open === true && unshown.releases === 1 && unshown.title === `Viby ${current}`,
      JSON.stringify({ open: unshown.open, releases: unshown.releases, title: unshown.title })
    )
    await close(app)

    // entries[5] leaves five unseen versions: three fit, two are counted.
    const baseline = entries[5].version
    const multi = await show(app, baseline, baseline)
    check(
      'a multi-version jump still fits the sheet',
      multi.open === true && multi.releases === 3,
      JSON.stringify({ open: multi.open, releases: multi.releases })
    )
    check('it counts the updates it left out', multi.earlier === 'And 2 earlier updates.', multi.earlier)

    await close(app)

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
    check(
      'Settings reopens the same sheet',
      reopened.open === true && reopened.title === `Viby ${current}`,
      JSON.stringify(reopened)
    )

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
        await window.__viby.api.settings.set({
          lastSeenVersion: ${JSON.stringify(before.lastSeenVersion ?? '')},
          lastShownVersion: ${JSON.stringify(before.lastShownVersion ?? '')}
        })
        await window.__viby.changelog.refresh()
        // Let the sheet make its decision, then close it without writing: the
        // restored baseline is the user's, and a real launch should see it.
        await new Promise((r) => setTimeout(r, 900))
        window.__viby.changelog.open = false
        window.__viby.changelog.entries = []
        window.__viby.changelog.earlier = 0
        return true
      })()`
    )
    await sleep(100)
  }
}
