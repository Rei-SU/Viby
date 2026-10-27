/**
 * Carousels are a single row, but they should never show a half card at the
 * edge. Spotify's shelves do the same thing when the Now Playing panel takes
 * width from the main view: the number of visible cards changes, and the cards
 * resize so only whole cards sit inside the content area.
 *
 * The rail owns the calculation. Each card inherits --rail-card-width, so a
 * rail can change from six cards to four without changing the card markup.
 *
 * On Windows a vertical mouse wheel over the rail scrolls it horizontally
 * instead of the page; macOS keeps the native trackpad gesture. The header
 * chevrons live in Rail.svelte.
 */

export const RAIL_GAP_FALLBACK = 18
export const RAIL_MIN_CARD = 130
export const RAIL_MAX_CARD = 176

export interface RailLayout {
  /** Number of cards that should fit in one viewport. */
  cols: number
  /** Width of every card in that viewport, in CSS pixels. */
  cardWidth: number
}

/**
 * Fit whole cards to `available` pixels. Prefer as many cards as fit while
 * keeping every card at least RAIL_MIN_CARD wide; if that is impossible, use the
 * smallest count that keeps cards at or under RAIL_MAX_CARD.
 */
export function railLayout(available: number, itemCount: number, gap = RAIL_GAP_FALLBACK): RailLayout {
  if (!Number.isFinite(available) || !Number.isFinite(gap) || available <= 0 || itemCount <= 0) {
    return { cols: 0, cardWidth: 0 }
  }

  const safeGap = Math.max(0, gap)
  const byMin = Math.floor((available + safeGap) / (RAIL_MIN_CARD + safeGap))
  const byMax = Math.ceil((available + safeGap) / (RAIL_MAX_CARD + safeGap))
  // Slots are based on the rail width, not the item count: a short shelf keeps
  // the same card size as a full shelf and simply leaves the last slots open.
  const cols = Math.max(1, Math.max(byMin, byMax))
  const cardWidth = Math.min(
    RAIL_MAX_CARD,
    (available - (cols - 1) * safeGap) / cols
  )

  return { cols, cardWidth }
}

/** Mouse-wheel-to-horizontal is a Windows nicety; macOS keeps the trackpad. */
function wantsWheelScroll(): boolean {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
}

/**
 * Observe a rail's width and item count. Writes --rail-card-width so the
 * cards in the rail all take the same fitted width, records the column count
 * for tests/debugging, and routes the Windows wheel sideways.
 */
export function fitRail(node: HTMLElement): { destroy(): void } {
  let frame = 0

  const update = (): void => {
    const style = getComputedStyle(node)
    const gap = parseFloat(style.columnGap) || RAIL_GAP_FALLBACK
    const padLeft = parseFloat(style.paddingLeft) || 0
    const padRight = parseFloat(style.paddingRight) || 0
    const available = node.clientWidth - padLeft - padRight
    const { cols, cardWidth } = railLayout(available, node.children.length, gap)

    if (cols === 0) return

    node.style.setProperty('--rail-card-width', `${cardWidth}px`)
    node.dataset.railCols = String(cols)
  }

  const schedule = (): void => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      update()
    })
  }

  const onWheel = (event: WheelEvent): void => {
    if (!wantsWheelScroll() || event.ctrlKey) return
    const max = node.scrollWidth - node.clientWidth
    if (max <= 1) return

    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    let delta = horizontal ? event.deltaX : event.deltaY
    if (event.deltaMode === 1) delta *= 16
    else if (event.deltaMode === 2) delta *= node.clientWidth
    if (delta === 0) return

    const nextLeft = Math.max(0, Math.min(max, node.scrollLeft + delta))
    // At either end let the page take the wheel, like nested scrolling.
    if (nextLeft === node.scrollLeft) return
    event.preventDefault()
    node.scrollLeft = nextLeft
  }

  node.addEventListener('wheel', onWheel, { passive: false })

  const resize = new ResizeObserver(schedule)
  resize.observe(node)

  // Shelves and search rails can replace their children after a fetch.
  const mutations = new MutationObserver(schedule)
  mutations.observe(node, { childList: true })

  update()

  return {
    destroy(): void {
      resize.disconnect()
      mutations.disconnect()
      node.removeEventListener('wheel', onWheel)
      if (frame) cancelAnimationFrame(frame)
    }
  }
}
