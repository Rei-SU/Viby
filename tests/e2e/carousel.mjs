export const description =
  'Carousels hide their scrollbar, put chevrons in the shelf header, and take the wheel on Windows'

export async function run(app, check) {
  const state = await app.evaluate(
    `(async () => {
      const { nav } = window.__viby
      nav.go('home')
      let rails = []
      for (let i = 0; i < 60; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        rails = [...document.querySelectorAll('.rail')]
        if (
          rails.length > 0 &&
          rails.some(
            (rail) =>
              rail.scrollWidth > rail.clientWidth + 2 &&
              (rail.closest('.shelf')?.querySelectorAll('.nav').length ?? 0) === 2
          )
        ) {
          break
        }
      }
      const overflowing = rails.find((rail) => rail.scrollWidth > rail.clientWidth + 2)
      if (!overflowing) return { error: 'no overflowing rail' }

      const shelf = overflowing.closest('.shelf')
      const buttons = shelf ? [...shelf.querySelectorAll('.nav')] : []
      const next = buttons.find((button) => button.classList.contains('next'))
      const railRect = overflowing.getBoundingClientRect()
      const buttonRect = next?.getBoundingClientRect() ?? null
      const scrollbarWidth = getComputedStyle(overflowing).scrollbarWidth
      const before = overflowing.scrollLeft
      next?.click()
      await new Promise((resolve) => setTimeout(resolve, 800))
      return {
        rails: rails.length,
        groups: rails.map((rail) => {
          const owner = rail.closest('.shelf')
          return {
            overflow: rail.scrollWidth > rail.clientWidth + 2,
            navs: owner?.querySelectorAll('.nav').length ?? 0
          }
        }),
        scrollbarWidth,
        before,
        after: overflowing.scrollLeft,
        prevEnabled: !buttons.find((button) => button.classList.contains('prev'))?.disabled,
        buttonsInHeader:
          Boolean(buttonRect) && Boolean(railRect) && buttonRect.bottom <= railRect.top + 2
      }
    })()`,
    { userGesture: true }
  )

  check(
    'overflowing shelves put two chevrons in the header',
    state.groups.every((group) => (group.overflow ? group.navs === 2 : group.navs === 0)),
    JSON.stringify(state.groups)
  )
  check('the chevrons sit above the rail, not on the cards', state.buttonsInHeader === true, JSON.stringify(state))
  check('rails hide their scrollbar', state.scrollbarWidth === 'none', String(state.scrollbarWidth))
  check('the next button scrolls the rail', state.after > state.before, `${state.before} → ${state.after}`)
  check('the previous button becomes available', state.prevEnabled === true)

  const wheel = await app.evaluate(
    `(async () => {
      if (window.viby.platform !== 'win32') return { skipped: true }
      const rail = [...document.querySelectorAll('.rail')].find(
        (node) => node.scrollWidth > node.clientWidth + 2
      )
      if (!rail) return { error: 'no rail' }
      rail.scrollLeft = Math.floor((rail.scrollWidth - rail.clientWidth) / 2)
      await new Promise((resolve) => setTimeout(resolve, 100))
      const before = rail.scrollLeft
      const event = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
      const notCancelled = rail.dispatchEvent(event)
      await new Promise((resolve) => setTimeout(resolve, 100))
      return {
        skipped: false,
        before,
        after: rail.scrollLeft,
        prevented: event.defaultPrevented,
        notCancelled
      }
    })()`,
    { userGesture: true }
  )
  if (wheel.skipped) {
    check('wheel scrolling is Windows-only (skipped on this platform)', true)
  } else {
    check(
      'the mouse wheel moves the carousel on Windows',
      wheel.after > wheel.before && wheel.prevented === true,
      JSON.stringify(wheel)
    )
  }
}
