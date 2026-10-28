export const description =
  'Queue docks beside the page, reorders by drag and key, and shares the panel with lyrics'

export async function run(app, check) {
  // A synthetic queue keeps this scenario offline and silent.
  const seeded = await app.evaluate(`(async () => {
    const { player, sidePanel } = window.__viby
    sidePanel.close()
    // The grid track takes 300ms to collapse; measuring before it settles reads
    // the open width and makes the "page gives up the panel width" check flake.
    await new Promise((resolve) => setTimeout(resolve, 400))
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

  // Drag a song in from outside the queue. Home rows are history rows: they have
  // no Add-to-queue button, which is exactly the "any song" case.
  const flow = await app.evaluate(
    `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const { api, nav, player } = window.__viby
      const now = Date.now()
      const thumb = ${JSON.stringify(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
      )}
      const titles = ['Drag test one', 'Drag test two']
      for (const [i, title] of titles.entries()) {
        await api.history.add({
          trackId: 'queue-drag-' + (i + 1),
          title,
          artist: 'Drag Artist',
          album: 'Drag album',
          durationSec: 200,
          playedAt: now + i,
          completion: 1,
          thumbnail: thumb
        })
      }
      nav.go('library')
      await wait(250)
      nav.go('home')
      await wait(1000)

      const recent = () => [...document.querySelectorAll('.recent-list li')]
      const byTitle = (title) =>
        recent().find((row) => row.querySelector('.title')?.textContent?.trim() === title)
      const start = (row) => {
        const dt = new DataTransfer()
        row.dispatchEvent(
          new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })
        )
        return dt
      }
      const at = (dt, x, y) => ({
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: x,
        clientY: y
      })
      const order = () => player.queue.map((track) => track.title)
      const toast = () =>
        document.querySelector('.alerts .toast')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null

      const report = {}
      report.sources = recent().length
      report.draggable = recent().length > 0 && recent().every((row) => row.draggable)

      // A. An empty queue still accepts a drop, and the drag advertises itself.
      const first = byTitle('Drag test one')
      const dtA = start(first)
      await wait(80)
      report.barShown = Boolean(document.querySelector('.drop-bar'))
      report.buttonReady =
        document.querySelector('.dock .icon[aria-label="Queue"]')?.classList.contains('drop-ready') ??
        false
      const queue = document.querySelector('.panel .queue')
      const qr = queue.getBoundingClientRect()
      queue.dispatchEvent(new DragEvent('dragover', at(dtA, qr.left + 140, qr.top + 60)))
      await wait(80)
      report.emptyHint = queue.classList.contains('drop-active')
      queue.dispatchEvent(new DragEvent('drop', at(dtA, qr.left + 140, qr.top + 60)))
      first.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dtA }))
      await wait(250)
      report.emptyDrop = {
        order: order(),
        toast: toast(),
        emptyGone: !document.querySelector('.panel .queue .empty'),
        barGone: !document.querySelector('.drop-bar')
      }

      // B. Dropping between two rows inserts at that slot, with a line as the cue.
      player.clearQueue()
      player.enqueueAll([
        { id: 'drag-a', kind: 'song', title: 'Queue A', subtitle: 'a', durationSec: 60 },
        { id: 'drag-b', kind: 'song', title: 'Queue B', subtitle: 'b', durationSec: 60 },
        { id: 'drag-c', kind: 'song', title: 'Queue C', subtitle: 'c', durationSec: 60 }
      ])
      await wait(250)
      const second = byTitle('Drag test two')
      const dtB = start(second)
      await wait(80)
      const rows = [...document.querySelectorAll('.panel .queue li')]
      const target = rows[1].getBoundingClientRect()
      const queueB = document.querySelector('.panel .queue')
      const optsB = at(dtB, target.left + 120, target.top + target.height / 2)
      queueB.dispatchEvent(new DragEvent('dragover', optsB))
      await wait(100)
      const line = document.querySelector('.panel .drop-line')
      report.line = line ? Math.round(parseFloat(line.style.top)) : null
      report.lineAtSecondRow = line
        ? Math.abs(line.getBoundingClientRect().top - target.top) <= 2
        : false
      queueB.dispatchEvent(new DragEvent('drop', optsB))
      second.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dtB }))
      await wait(250)
      report.positioned = {
        order: order(),
        toast: toast(),
        lineGone: !document.querySelector('.panel .drop-line')
      }

      // C. The floating bar appends.
      const dtC = start(byTitle('Drag test one'))
      await wait(80)
      const bar = document.querySelector('.drop-bar')
      const br = bar.getBoundingClientRect()
      const optsC = at(dtC, br.left + 30, br.top + br.height / 2)
      bar.dispatchEvent(new DragEvent('dragover', optsC))
      await wait(80)
      report.barOver = bar.classList.contains('over')
      bar.dispatchEvent(new DragEvent('drop', optsC))
      byTitle('Drag test one')?.dispatchEvent(
        new DragEvent('dragend', { bubbles: true, dataTransfer: dtC })
      )
      await wait(250)
      report.appendedByBar = { order: order(), toast: toast() }

      // D. The player-bar queue button appends too.
      const dtD = start(byTitle('Drag test two'))
      await wait(80)
      const button = document.querySelector('.dock .icon[aria-label="Queue"]')
      const dr = button.getBoundingClientRect()
      const optsD = at(dtD, dr.left + 10, dr.top + 10)
      button.dispatchEvent(new DragEvent('dragover', optsD))
      await wait(80)
      report.buttonOver = button.classList.contains('queue-over')
      button.dispatchEvent(new DragEvent('drop', optsD))
      byTitle('Drag test two')?.dispatchEvent(
        new DragEvent('dragend', { bubbles: true, dataTransfer: dtD })
      )
      await wait(250)
      report.appendedByButton = { order: order(), toast: toast() }

      await api.debug?.forgetHistory(titles)
      return report
    })()`,
    { userGesture: true }
  )

  check(
    'every song row is draggable, with or without a queue button',
    flow.sources >= 2 && flow.draggable === true,
    JSON.stringify({ sources: flow.sources, draggable: flow.draggable })
  )
  check(
    'a drag advertises the queue button and the drop bar',
    flow.barShown === true && flow.buttonReady === true,
    JSON.stringify({ bar: flow.barShown, button: flow.buttonReady })
  )
  check(
    'an empty queue accepts a drop',
    flow.emptyDrop?.order.join(',') === 'Drag test one' &&
      flow.emptyDrop?.emptyGone === true &&
      /Added Drag test one to queue/.test(flow.emptyDrop?.toast ?? '') &&
      flow.emptyHint === true &&
      flow.emptyDrop?.barGone === true,
    JSON.stringify(flow.emptyDrop)
  )
  check(
    'the drop line marks the slot under the pointer',
    Number.isFinite(flow.line) && flow.lineAtSecondRow === true,
    JSON.stringify({ line: flow.line, atRow: flow.lineAtSecondRow })
  )
  check(
    'dropping between rows inserts there, not at the end',
    flow.positioned?.order.join(',') === 'Queue A,Drag test two,Queue B,Queue C' &&
      flow.positioned?.lineGone === true &&
      /Added Drag test two to queue/.test(flow.positioned?.toast ?? ''),
    JSON.stringify(flow.positioned)
  )
  check(
    'the floating bar appends to the queue',
    flow.barOver === true &&
      flow.appendedByBar?.order.join(',') ===
        'Queue A,Drag test two,Queue B,Queue C,Drag test one' &&
      /Added Drag test one to queue/.test(flow.appendedByBar?.toast ?? ''),
    JSON.stringify(flow.appendedByBar)
  )
  check(
    'the queue button appends to the queue',
    flow.buttonOver === true &&
      flow.appendedByButton?.order.join(',') ===
        'Queue A,Drag test two,Queue B,Queue C,Drag test one,Drag test two' &&
      /Added Drag test two to queue/.test(flow.appendedByButton?.toast ?? ''),
    JSON.stringify(flow.appendedByButton)
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
