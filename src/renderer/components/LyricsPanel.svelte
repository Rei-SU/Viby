<script lang="ts">
  import { lyrics } from '../lib/lyrics.svelte'
  import { player } from '../lib/player.svelte'
  import Icon from './Icon.svelte'

  let listEl = $state<HTMLDivElement | undefined>(undefined)
  let lineEls = $state<(HTMLElement | undefined)[]>([])
  let wasOpen = false
  let lastData: typeof lyrics.data = null

  /** The skeleton is part of opening the panel, even when the lyrics are cached. */
  const MIN_LOADING_MS = 1500
  let loadingHold = $state(false)
  let heldOpen = false

  $effect(() => {
    const open = lyrics.open
    if (open === heldOpen) return
    heldOpen = open
    if (!open) {
      loadingHold = false
      return
    }
    loadingHold = true
    const timer = setTimeout(() => (loadingHold = false), MIN_LOADING_MS)
    return () => clearTimeout(timer)
  })

  const showingLoading = $derived(lyrics.loading || loadingHold)

  const lines = $derived(lyrics.data?.kind === 'synced' ? (lyrics.data.lines ?? []) : [])

  /** Index of the line that is playing right now. */
  const activeIndex = $derived.by(() => {
    if (lines.length === 0) return -1
    const time = player.position + 0.12
    let index = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= time) index = i
      else break
    }
    return index
  })

  // Keep the current line centred. Opening and track changes jump (so the panel
  // never glides up from the previous song's last line); later changes glide.
  $effect(() => {
    const data = lyrics.data
    const index = activeIndex
    const open = lyrics.open
    const justOpened = open && !wasOpen
    wasOpen = open

    // A different track's lyrics reuses the same <div>: reset it before the
    // next line becomes active, otherwise it inherits the old scroll position.
    const newLyrics = data !== lastData
    lastData = data

    if (!open || !listEl) return

    // A new track before its first timestamp: glide back to the top instead of
    // snapping. The scroll starts as soon as the new lyrics render, not when
    // their first line happens to become active.
    if (newLyrics && index < 0) {
      listEl.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    if (index < 0) return

    const line = lineEls[index]
    if (!line) return

    const top = line.offsetTop - listEl.clientHeight / 2 + line.clientHeight / 2
    listEl.scrollTo({ top, behavior: justOpened ? 'auto' : 'smooth' })
  })

  function seek(index: number): void {
    const line = lines[index]
    if (line) player.seek(line.time)
  }
</script>

<aside class="panel" class:open={lyrics.open} aria-hidden={!lyrics.open} aria-label="Lyrics">
  <div class="panel-inner">
    <header>
      <span class="eyebrow">Lyrics</span>
      {#if !showingLoading && lyrics.data?.kind === 'synced'}
        <span class="sync-badge synced" title="Lyrics follow the track">
          <span class="sync-dot" aria-hidden="true"></span>Synced
        </span>
      {:else if !showingLoading && lyrics.data?.kind === 'plain'}
        <span class="sync-badge" title="Lyrics are not time-synced">
          <span class="sync-dot" aria-hidden="true"></span>Unsynced
        </span>
      {/if}
      {#if !showingLoading && lyrics.data?.source}
        <span class="source">{lyrics.data.source}</span>
      {/if}
      <button class="close" onclick={() => lyrics.close()} aria-label="Close lyrics">
        <Icon name="close" size={15} />
      </button>
    </header>

    <div class="body" class:synced={lyrics.data?.kind === 'synced'}>
      {#if showingLoading}
        <div class="loading" role="status">
          <div class="loading-head">
            <span class="equalizer" aria-hidden="true">
              <span></span><span></span><span></span><span></span>
            </span>
            <span>Finding lyrics</span>
          </div>
          <div class="skeleton" aria-hidden="true">
            {#each [64, 86, 48, 74, 56, 39] as width, i}
              <span class="skeleton-line" style="--w: {width}%; --i: {i}"></span>
            {/each}
          </div>
        </div>
      {:else if lyrics.error}
        <p class="status">{lyrics.error}</p>
      {:else if !lyrics.data || lyrics.data.kind === 'none'}
        <p class="status">No lyrics for this track.</p>
      {:else if lyrics.data.kind === 'instrumental'}
        <p class="status">Instrumental.</p>
      {:else if lyrics.data.kind === 'plain'}
        <div class="plain scroll">{lyrics.data.plain}</div>
      {:else}
        <div class="lines scroll" bind:this={listEl}>
          {#each lines as line, i (i)}
            <button
              class="line"
              class:active={i === activeIndex}
              class:past={i < activeIndex}
              bind:this={lineEls[i]}
              onclick={() => seek(i)}
            >
              <span>{line.text}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</aside>

<style>
  .panel {
    grid-column: 3;
    grid-row: 2;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    /* A single hairline marks the edge of the docked panel. It is deliberately
       weaker than the old raised surface/border treatment: no background step,
       no gutter, just enough contrast to read where the page ends. */
    background: var(--bg);
    border-left: 1px solid var(--stroke);
    pointer-events: none;
    visibility: hidden;
    /* The grid track collapses over 300ms. Keep the panel visible until the
       collapse finishes so the content is clipped rather than disappearing. */
    transition: visibility 0s linear 300ms;
  }

  .panel.open {
    pointer-events: auto;
    visibility: visible;
    transition: visibility 0s;
  }

  /* Keep the inner panel at a stable width while the grid track animates. If
     the panel itself narrowed, every lyric line would reflow during the
     expansion. */
  .panel-inner {
    width: calc(var(--lyrics-w) - 1px);
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 20px 10px;
    flex-shrink: 0;
  }

  .eyebrow {
    font-size: 10.5px;
    font-weight: 550;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-faint);
  }

  .source {
    font-size: 10px;
    color: var(--text-faint);
    border: 1px solid var(--stroke);
    border-radius: 999px;
    padding: 1px 6px;
  }

  .sync-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 1px 7px 1px 6px;
    border: 1px solid var(--stroke);
    border-radius: 999px;
    color: var(--text-faint);
    font-size: 9.5px;
    font-weight: 550;
    letter-spacing: 0.02em;
  }

  .sync-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
  }

  .sync-badge.synced {
    color: var(--text-dim);
    border-color: var(--stroke-strong);
    background: var(--glass-active);
  }

  .sync-badge.synced .sync-dot {
    position: relative;
    color: var(--text);
  }

  .sync-badge.synced .sync-dot::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: currentColor;
    animation: sync-pulse 2.4s var(--ease) infinite;
  }

  @keyframes sync-pulse {
    0% {
      opacity: 0.6;
      transform: scale(1);
    }
    60%,
    100% {
      opacity: 0;
      transform: scale(2.6);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sync-badge.synced .sync-dot::after {
      animation: none;
      opacity: 0;
    }
  }

  .close {
    margin-left: auto;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 7px;
    color: var(--text-dim);
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .close:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .body.synced {
    position: relative;
  }

  /* Static overlays preserve the edge fades without masking the scrolling layer. */
  .body.synced::before,
  .body.synced::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    height: 18%;
    z-index: 2;
    pointer-events: none;
  }

  .body.synced::before {
    top: 0;
    background: linear-gradient(to bottom, var(--bg), transparent);
  }

  .body.synced::after {
    bottom: 0;
    background: linear-gradient(to top, var(--bg), transparent);
  }

  .status {
    margin: 0;
    padding: 8px 22px;
    color: var(--text-faint);
    font-size: 13px;
  }

  .loading {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 22px;
    animation: loading-in 220ms var(--ease);
  }

  .loading-head {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-bottom: 24px;
    color: var(--text-faint);
    font-size: 10.5px;
    font-weight: 550;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }

  .equalizer {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 11px;
  }

  .equalizer span {
    width: 2px;
    height: 100%;
    border-radius: 2px;
    background: currentColor;
    transform-origin: center;
    animation: equalizer 900ms ease-in-out infinite alternate;
  }

  .equalizer span:nth-child(1) {
    height: 6px;
    animation-delay: -200ms;
  }

  .equalizer span:nth-child(2) {
    height: 11px;
    animation-delay: -650ms;
  }

  .equalizer span:nth-child(3) {
    height: 8px;
    animation-delay: -420ms;
  }

  .equalizer span:nth-child(4) {
    height: 5px;
    animation-delay: -810ms;
  }

  .skeleton {
    display: grid;
    gap: 18px;
  }

  .skeleton-line {
    position: relative;
    width: var(--w);
    height: 10px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.05);
  }

  .skeleton-line::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 48%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.11), transparent);
    transform: translateX(-120%);
    animation: skeleton-sweep 2.2s var(--ease) infinite;
    animation-delay: calc(var(--i) * 70ms);
  }

  @keyframes loading-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }

  @keyframes equalizer {
    from {
      opacity: 0.45;
      transform: scaleY(0.35);
    }
    to {
      opacity: 1;
      transform: scaleY(1);
    }
  }

  @keyframes skeleton-sweep {
    0% {
      transform: translateX(-120%);
    }
    65%,
    100% {
      transform: translateX(330%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .loading {
      animation: none;
    }

    .equalizer span,
    .skeleton-line::after {
      animation: none;
    }

    .skeleton-line::after {
      opacity: 0;
    }
  }

  .plain {
    margin: 0;
    padding: 4px 22px 40px;
    color: var(--text-dim);
    font-size: 14px;
    line-height: 1.7;
    white-space: pre-line;
    overflow-y: auto;
  }

  .lines {
    flex: 1;
    min-height: 0;
    /* Left padding is the visible alignment. The extra 26px on the right is
       headroom for the active line's 1.08 scale: it grows into reserved space
       instead of through the padding and against the panel edge. */
    padding: 34vh 48px 34vh 22px;
    overflow-y: auto;
    scrollbar-width: none;
  }

  .lines::-webkit-scrollbar {
    display: none;
  }

  .line {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 0;
    font-size: 15.5px;
    line-height: 1.42;
    font-weight: 550;
    color: var(--text);
    /* Keep the left edge aligned with every other line; the reserved right
       padding absorbs the 8% growth. */
    transform-origin: left center;
    transition: transform 240ms var(--ease);
  }

  /* Text opacity preserves the fade without repainting its color every frame. */
  .line > span {
    display: block;
    opacity: 0.41;
    transition: opacity 240ms var(--ease);
  }

  .line.past > span {
    opacity: 0.1845;
  }

  .line:hover > span {
    opacity: 0.63;
  }

  .line.past:hover > span {
    opacity: 0.2835;
  }

  .line.active {
    font-weight: 650;
    transform: scale(1.08);
  }

  .line.active > span,
  .line.active:hover > span {
    opacity: 1;
  }
</style>
