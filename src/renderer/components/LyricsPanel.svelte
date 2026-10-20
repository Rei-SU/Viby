<script lang="ts">
  import { lyrics } from '../lib/lyrics.svelte'
  import { player } from '../lib/player.svelte'
  import Icon from './Icon.svelte'

  let listEl = $state<HTMLDivElement | undefined>(undefined)
  let lineEls = $state<(HTMLElement | undefined)[]>([])
  let wasOpen = false
  let lastData: typeof lyrics.data = null

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
  <header>
    <span class="eyebrow">Lyrics</span>
    {#if lyrics.data?.source}
      <span class="source">{lyrics.data.source}</span>
    {/if}
    <button class="close" onclick={() => lyrics.close()} aria-label="Close lyrics">
      <Icon name="close" size={15} />
    </button>
  </header>

  <div class="body">
    {#if lyrics.loading}
      <p class="status">Finding lyrics…</p>
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
            {line.text}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</aside>

<style>
  .panel {
    position: fixed;
    top: var(--titlebar-h);
    right: 0;
    bottom: var(--player-h);
    width: min(380px, 44vw);
    z-index: 40;
    display: flex;
    flex-direction: column;
    background: rgba(11, 11, 15, 0.78);
    backdrop-filter: blur(32px) saturate(150%);
    -webkit-backdrop-filter: blur(32px) saturate(150%);
    border-left: 1px solid var(--stroke);
    box-shadow: -30px 0 60px rgba(0, 0, 0, 0.35);
    transform: translateX(102%);
    opacity: 0;
    pointer-events: none;
    /* `visibility` waits for the slide to finish, so the panel is out of the
       tab order when closed without cutting the animation short. (`inert`
       froze the transition mid-flight in this Chromium build.) */
    visibility: hidden;
    /* Closing is the entrance played backwards: the panel slides right for the
       same 300ms. The fade is linear over the whole slide so the motion stays
       visible; the old ease-out fade dropped to 17% opacity in 60ms, which read
       as the panel blinking out rather than leaving. */
    transition:
      transform 300ms var(--ease),
      opacity 300ms linear,
      visibility 0s linear 300ms;
  }

  .panel.open {
    transform: translateX(0);
    opacity: 1;
    pointer-events: auto;
    visibility: visible;
    transition:
      transform 300ms var(--ease),
      opacity 220ms var(--ease),
      visibility 0s;
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

  .status {
    margin: 0;
    padding: 8px 22px;
    color: var(--text-faint);
    font-size: 13px;
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
    -webkit-mask-image: linear-gradient(
      to bottom,
      transparent 0%,
      #000 18%,
      #000 82%,
      transparent 100%
    );
    mask-image: linear-gradient(to bottom, transparent 0%, #000 18%, #000 82%, transparent 100%);
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
    color: var(--text-faint);
    /* Keep the left edge aligned with every other line; the reserved right
       padding absorbs the 8% growth. */
    transform-origin: left center;
    transition:
      color 240ms var(--ease),
      opacity 240ms var(--ease),
      transform 240ms var(--ease);
  }

  .line:hover {
    color: var(--text-dim);
  }

  .line.past {
    opacity: 0.45;
  }

  .line.active {
    color: var(--text);
    font-weight: 650;
    transform: scale(1.08);
  }
</style>
