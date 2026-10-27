export const description =
  'Queue docks beside the page, reorders by drag and key, and shares the panel with lyrics'

export async function run(app, check) {
  // A synthetic queue keeps this scenario offline and silent.
  const seeded = await app.evaluate(`(() => {
    const { player, sidePanel } = window.__viby
    sidePanel.close()
    player.clearQueue()
    player.enqueueAll([
      { id: 'panel-a', kind: 'song', title: 'Panel A', subtitle: 'one', durationSec: 60 },
      { id: 'panel-b', kind: 'song', title: 'Panel B', subtitle: 'two', durationSec: 60 },
      { id: 'panel-c', kind: 'song', title: 'Panel C', subtitle: 'three', durationSec: 60 }
    ])
    return player.queue.map((track) => track.title)
  })()`)
  check('seeded queue without playback', seeded.join(',') === 'Panel A,Panel B,Panel C', JSON.stringify(seeded))

  const closed = await app.evaluate(`(() => {
    const main = document.querySelector('.content')
    return {
      width: main?.getBoundingClientRect().width ?? 0,
      open: document.querySelector('aside.panel')?.classList.contains('open') ?? false
    }
  })()`)
  check('panel starts closed', closed.open === false)

  await app.evaluate(
    `(async () => {
      document.querySelector('.dock .icon[aria-label="Queue"]')?.click()
      await new Promise((r) => setTimeout(r, 450))
      return true
    })()`,
    { userGesture: true }
  )

  const opened = await app.evaluate(`(() => {
    const panel = document.querySelector('aside.panel')
    const inner = document.querySelector('.panel-inner')
    return {
      open: panel?.classList.contains('open') ?? false,
      eyebrow: document.querySelector('.panel .eyebrow')?.textContent?.trim() ?? null,
      count: document.querySelector('.panel .count')?.textContent?.trim() ?? null,
      rows: [...document.querySelectorAll('.panel .queue li')].map((row) =>
        row.querySelector('.t')?.textContent?.trim()
      ),
      mainWidth: document.querySelector('.content')?.getBoundingClientRect().width ?? 0,
      panelWidth: inner?.getBoundingClientRect().width ?? 0,
      autoplayInPanel: Boolean(document.querySelector('.panel .autoplay input'))
    }
  })()`)
  check(
    'queue button opens the docked panel',
    opened.open && opened.eyebrow === 'Queue',
    JSON.stringify(opened)
  )
  check(
    'panel shows the queue count and rows',
    opened.count === '3' && opened.rows.join(',') === 'Panel A,Panel B,Panel C',
    JSON.stringify(opened.rows)
  )
  check(
    'page gives up the panel width',
    opened.mainWidth < closed.width - 300,
    `${closed.width} → ${opened.mainWidth}`
  )
  check('panel has a usable width', opened.panelWidth >= 300, `${opened.panelWidth}px`)
  check('autoplay stays a Settings option', opened.autoplayInPanel === false)

  // Keyboard reorder on the grip: B up over A.
  const keyed = await app.evaluate(
    `(async () => {
      const grips = [...document.querySelectorAll('.panel .queue .grip')]
      grips[1]?.focus()
      grips[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
      await new Promise((r) => setTimeout(r, 250))
      return {
        order: window.__viby.player.queue.map((track) => track.title).join(','),
        index: window.__viby.player.index,
        focused: document.activeElement?.getAttribute('aria-label') ?? null,
        rows: [...document.querySelectorAll('.panel .queue li .t')].map((el) => el.textContent.trim())
      }
    })()`,
    { userGesture: true }
  )
  check(
    'the grip reorders with the arrow keys',
    keyed.order === 'Panel B,Panel A,Panel C' && keyed.rows.join(',') === keyed.order,
    JSON.stringify(keyed)
  )
  check('the current track follows its row', keyed.index === 1, `${keyed.index}`)
  check('focus stays on the moved row', keyed.focused === 'Reorder Panel B', String(keyed.focused))

  // Pointer drag: drop B after A.
  const dragged = await app.evaluate(
    `(async () => {
      const rows = [...document.querySelectorAll('.panel .queue li')]
      const grip = rows[0]?.querySelector('.grip')
      const first = rows[0].getBoundingClientRect()
      const second = rows[1].getBoundingClientRect()
      const startY = first.top + first.height / 2
      const dropY = second.bottom + 2
      grip.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 9,
          button: 0,
          clientY: startY
        })
      )
      window.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, pointerId: 9, clientY: dropY })
      )
      // Svelte flushes the drop line on the next microtask.
      await new Promise((r) => setTimeout(r, 50))
      const line = document.querySelector('.panel .drop-line')
      const lineTop = line ? parseFloat(line.style.top) : null
      window.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerId: 9, clientY: dropY })
      )
      await new Promise((r) => setTimeout(r, 250))
      return {
        line: Boolean(line),
        lineTop,
        order: window.__viby.player.queue.map((track) => track.title).join(','),
        index: window.__viby.player.index,
        lineAfter: Boolean(document.querySelector('.panel .drop-line'))
      }
    })()`,
    { userGesture: true }
  )
  check('dragging shows a drop line', dragged.line === true && Number.isFinite(dragged.lineTop), JSON.stringify(dragged))
  check(
    'dropping applies the new order',
    dragged.order === 'Panel A,Panel B,Panel C' && dragged.index === 0,
    JSON.stringify(dragged)
  )
  check('the drop line clears on release', dragged.lineAfter === false)

  // The same container can switch to lyrics. No track is playing, so the body
  // stays empty; this asserts the shell, header and close button follow.
  const switched = await app.evaluate(
    `(async () => {
      window.__viby.sidePanel.toggle('lyrics')
      await new Promise((r) => setTimeout(r, 350))
      return {
        eyebrow: document.querySelector('.panel .eyebrow')?.textContent?.trim() ?? null,
        mode: window.__viby.sidePanel.mode,
        closeLabel: document.querySelector('.panel .close')?.getAttribute('aria-label') ?? null
      }
    })()`,
    { userGesture: true }
  )
  check(
    'the panel is a shared container',
    switched.mode === 'lyrics' && switched.eyebrow === 'Lyrics',
    JSON.stringify(switched)
  )
  check('the close button follows the mode', switched.closeLabel === 'Close lyrics', String(switched.closeLabel))

  // Back to the queue, remove one row, then clear.
  const removed = await app.evaluate(
    `(async () => {
      window.__viby.sidePanel.toggle('queue')
      await new Promise((r) => setTimeout(r, 350))
      document.querySelectorAll('.panel .queue li .remove')[2]?.click()
      await new Promise((r) => setTimeout(r, 200))
      return {
        order: window.__viby.player.queue.map((track) => track.title).join(','),
        rows: document.querySelectorAll('.panel .queue li').length
      }
    })()`,
    { userGesture: true }
  )
  check(
    'the remove button works inside the panel',
    removed.order === 'Panel A,Panel B' && removed.rows === 2,
    JSON.stringify(removed)
  )

  const cleared = await app.evaluate(
    `(async () => {
      document.querySelector('.panel .clear')?.click()
      await new Promise((r) => setTimeout(r, 200))
      return {
        rows: document.querySelectorAll('.panel .queue li').length,
        empty: document.querySelector('.panel .queue .empty')?.textContent?.trim() ?? null,
        count: document.querySelector('.panel .count')?.textContent?.trim() ?? null
      }
    })()`,
    { userGesture: true }
  )
  check('clear empties the panel', cleared.rows === 0 && cleared.count === '0', JSON.stringify(cleared))
  check(
    'the empty state explains the queue',
    (cleared.empty ?? '').startsWith('Nothing queued'),
    String(cleared.empty)
  )

  const closedAgain = await app.evaluate(
    `(async () => {
      document.querySelector('.panel .close')?.click()
      await new Promise((r) => setTimeout(r, 450))
      return {
        open: document.querySelector('aside.panel')?.classList.contains('open') ?? false,
        mode: window.__viby.sidePanel.mode,
        mainWidth: document.querySelector('.content')?.getBoundingClientRect().width ?? 0
      }
    })()`,
    { userGesture: true }
  )
  check(
    'closing restores the page width',
    closedAgain.open === false && closedAgain.mode === null && closedAgain.mainWidth >= closed.width - 1,
    JSON.stringify(closedAgain)
  )
}
