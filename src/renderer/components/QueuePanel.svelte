<script lang="ts">
  import { onDestroy, tick } from 'svelte'
  import { player } from '../lib/player.svelte'
  import { downloads } from '../lib/downloads.svelte'
  import ArtistLinks from './ArtistLinks.svelte'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'

  function fmt(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return '—'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  type RowRect = { top: number; bottom: number }
  type Drag = {
    from: number
    pointerId: number
    startY: number
    lastY: number
    /** Row boxes in list-content coordinates, stable while the list scrolls. */
    rects: RowRect[]
    /** Insertion slot in the pre-drag list: 0 is "before the first row". */
    slot: number
    moved: boolean
  }

  const THRESHOLD = 4
  const EDGE = 44
  const SCROLL_STEP = 12

  let listEl = $state<HTMLUListElement | undefined>(undefined)
  let drag = $state<Drag | null>(null)
  let lineTop = $state(0)
  let lineVisible = $state(false)
  let announce = $state('')

  let scrollDir = 0
  let raf = 0

  // Closing the panel mid-drag must not leave window listeners behind.
  onDestroy(stopDrag)

  /** Row boxes relative to the scroll content, so autoscroll cannot skew them. */
  function measure(): RowRect[] {
    if (!listEl) return []
    const base = listEl.getBoundingClientRect().top - listEl.scrollTop
    return [...listEl.querySelectorAll<HTMLElement>(':scope > li')].map((row) => {
      const rect = row.getBoundingClientRect()
      return { top: rect.top - base, bottom: rect.bottom - base }
    })
  }

  function slotAt(clientY: number): number {
    if (!drag || !listEl) return 0
    const y = clientY - listEl.getBoundingClientRect().top + listEl.scrollTop
    for (let i = 0; i < drag.rects.length; i++) {
      if (y < (drag.rects[i].top + drag.rects[i].bottom) / 2) return i
    }
    return drag.rects.length
  }

  // A slot in the pre-drag list becomes a final index after the dragged row is
  // removed: slots after its old position shift up by one.
  function targetFor(slot: number): number {
    if (!drag) return -1
    return slot > drag.from ? slot - 1 : slot
  }

  function linePosition(slot: number): number {
    if (!drag || drag.rects.length === 0) return 0
    if (slot <= 0) return drag.rects[0].top
    if (slot >= drag.rects.length) return drag.rects[drag.rects.length - 1].bottom
    return drag.rects[slot].top
  }

  function update(clientY: number): void {
    if (!drag) return
    drag.lastY = clientY
    if (!drag.moved && Math.abs(clientY - drag.startY) < THRESHOLD) return
    drag.moved = true
    drag.slot = slotAt(clientY)

    const target = targetFor(drag.slot)
    lineVisible = target !== drag.from
    lineTop = linePosition(drag.slot)

    if (listEl) {
      const rect = listEl.getBoundingClientRect()
      scrollDir = clientY < rect.top + EDGE ? -1 : clientY > rect.bottom - EDGE ? 1 : 0
    }
  }

  function autoScroll(): void {
    if (!drag) return
    if (scrollDir !== 0 && listEl) {
      const before = listEl.scrollTop
      listEl.scrollTop += scrollDir * SCROLL_STEP
      if (listEl.scrollTop !== before) update(drag.lastY)
    }
    raf = requestAnimationFrame(autoScroll)
  }

  function startDrag(event: PointerEvent, from: number): void {
    if (event.button !== 0 || !listEl) return
    event.preventDefault()

    try {
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    } catch {
      // Synthetic pointers (tests) have no active capture.
    }

    drag = {
      from,
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      rects: measure(),
      slot: from,
      moved: false
    }
    lineVisible = false
    lineTop = linePosition(from)
    scrollDir = 0

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', stopDrag)
    window.addEventListener('keydown', onEscape)
    raf = requestAnimationFrame(autoScroll)
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return
    update(event.clientY)
  }

  function onPointerUp(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return
    const { from, moved } = drag
    const target = targetFor(drag.slot)
    stopDrag()
    if (moved && target >= 0 && target !== from) commitMove(from, target)
  }

  function onEscape(event: KeyboardEvent): void {
    if (!drag || event.key !== 'Escape') return
    event.preventDefault()
    stopDrag()
  }

  function stopDrag(): void {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', stopDrag)
    window.removeEventListener('keydown', onEscape)
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    scrollDir = 0
    drag = null
    lineVisible = false
  }

  function commitMove(from: number, to: number): void {
    player.move(from, to)
    announce = `Moved to position ${to + 1} of ${player.queue.length}`
    void refocus(to)
  }

  /** Keep the grip under the focus after the list reorders (rows are index-keyed). */
  async function refocus(index: number): Promise<void> {
    await tick()
    listEl?.querySelectorAll<HTMLButtonElement>('.grip')[index]?.focus()
  }

  function reorderByKey(event: KeyboardEvent, index: number): void {
    const last = player.queue.length - 1
    let to = index
    if (event.key === 'ArrowUp') to = Math.max(0, index - 1)
    else if (event.key === 'ArrowDown') to = Math.min(last, index + 1)
    else if (event.key === 'Home') to = 0
    else if (event.key === 'End') to = last
    else return

    event.preventDefault()
    event.stopPropagation()
    if (to !== index) commitMove(index, to)
  }
</script>

<div class="queue">
  {#if player.queue.length === 0}
    <p class="empty">Nothing queued. Play a song and it lines up here.</p>
  {:else}
    <ul class="list scroll" class:dragging={drag?.moved} bind:this={listEl}>
      {#each player.queue as track, i (track.id + '-' + i)}
        <li class:current={i === player.index} class:lifted={drag?.from === i && drag.moved}>
          <button
            type="button"
            class="grip"
            title="Drag to reorder, or use the arrow keys"
            aria-label={`Reorder ${track.title}`}
            onpointerdown={(event) => startDrag(event, i)}
            onkeydown={(event) => reorderByKey(event, i)}
          >
            <Icon name="grip" size={14} />
          </button>

          <div
            class="row"
            role="button"
            tabindex="0"
            onclick={() => player.playAt(i)}
            onkeydown={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                player.playAt(i)
              }
            }}
          >
            <span class="idx tabular">
              {#if i === player.index && player.playing}
                <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
              {:else}
                {i + 1}
              {/if}
            </span>
            <Cover src={track.thumbnail} size={34} radius={6} alt={track.title} />
            <span class="text">
              <span class="t truncate">{track.title}</span>
              <span class="a truncate">
                <ArtistLinks parts={track.artistParts} name={track.artist} id={track.artistId} />
              </span>
            </span>
            {#if downloads.stateFor(track.id) === 'done'}
              <span class="dl" title="Downloaded"><Icon name="check" size={11} /></span>
            {:else if downloads.stateFor(track.id) === 'downloading' ||
              downloads.stateFor(track.id) === 'queued'}
              <span class="dl busy" title="Downloading…"><Icon name="download" size={11} /></span>
            {/if}
            <span class="len tabular">{fmt(track.durationSec)}</span>
          </div>

          <button
            class="remove"
            title="Remove"
            aria-label="Remove from queue"
            onclick={() => player.removeAt(i)}
          >
            <Icon name="close" size={14} />
          </button>
        </li>
      {/each}

      {#if drag?.moved && lineVisible}
        <span class="drop-line" style="top: {lineTop}px" aria-hidden="true"></span>
      {/if}
    </ul>
  {/if}

  <span class="sr" role="status" aria-live="polite">{announce}</span>
</div>

<style>
  .queue {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .empty {
    flex: 1;
    color: var(--text-faint);
    font-size: 13px;
    line-height: 1.5;
    padding: 6px 20px;
    margin: 0;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0 12px 12px;
    min-height: 0;
    flex: 1;
    position: relative;
  }

  .list.dragging {
    user-select: none;
    cursor: grabbing;
  }

  li {
    display: flex;
    align-items: center;
    border-radius: 10px;
    transition: background var(--speed) var(--ease);
  }

  li:hover {
    background: var(--glass-hover);
  }

  li.current {
    background: var(--glass-active);
  }

  li.lifted {
    background: var(--glass-active);
  }

  li.lifted .row,
  li.lifted .grip {
    opacity: 0.45;
  }

  .grip {
    display: grid;
    place-items: center;
    width: 18px;
    height: 26px;
    flex-shrink: 0;
    border-radius: 6px;
    color: var(--text-faint);
    cursor: grab;
    opacity: 0;
    pointer-events: none;
    touch-action: none;
    transition: opacity var(--speed) var(--ease);
  }

  li:hover .grip,
  li:focus-within .grip,
  .grip:focus-visible {
    opacity: 1;
    pointer-events: auto;
  }

  li.lifted .grip {
    cursor: grabbing;
  }

  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 6px;
    text-align: left;
  }

  .idx {
    width: 16px;
    color: var(--text-faint);
    font-size: 11px;
    text-align: right;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
    gap: 1px;
  }

  .t {
    font-size: 12.5px;
    font-weight: 480;
  }

  li.current .t {
    color: var(--text);
  }

  .a {
    font-size: 11.5px;
    color: var(--text-faint);
  }

  .len {
    color: var(--text-faint);
    font-size: 11px;
    flex-shrink: 0;
  }

  .dl {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    color: var(--text-dim);
  }

  .dl.busy {
    color: #f0c477;
  }

  .remove {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    margin-right: 2px;
    border-radius: 7px;
    color: var(--text-faint);
    flex-shrink: 0;
    opacity: 0;
    transition:
      opacity var(--speed) var(--ease),
      color var(--speed) var(--ease),
      background var(--speed) var(--ease);
  }

  li:hover .remove,
  li:focus-within .remove,
  .remove:focus-visible {
    opacity: 1;
  }

  .remove:hover {
    color: var(--danger);
    background: var(--glass-hover);
  }

  .drop-line {
    position: absolute;
    left: 18px;
    right: 12px;
    height: 2px;
    margin-top: -1px;
    border-radius: 2px;
    background: var(--text);
    pointer-events: none;
    z-index: 1;
  }

  .eq {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 11px;
  }

  .eq i {
    width: 2px;
    border-radius: 1px;
    background: var(--accent);
    animation: bounce 900ms ease-in-out infinite;
  }

  .eq i:nth-child(1) {
    height: 5px;
    animation-delay: -200ms;
  }

  .eq i:nth-child(2) {
    height: 11px;
    animation-delay: -500ms;
  }

  .eq i:nth-child(3) {
    height: 7px;
    animation-delay: -100ms;
  }

  @keyframes bounce {
    0%,
    100% {
      transform: scaleY(0.4);
    }
    50% {
      transform: scaleY(1);
    }
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .eq i {
      animation: none;
    }
  }
</style>
