<script lang="ts">
  import { sidePanel } from '../lib/side-panel.svelte'
  import { lyrics } from '../lib/lyrics.svelte'
  import { player } from '../lib/player.svelte'
  import { history } from '../lib/history.svelte'
  import LyricsPanel from './LyricsPanel.svelte'
  import QueuePanel from './QueuePanel.svelte'
  import HistoryPanel from './HistoryPanel.svelte'
  import Icon from './Icon.svelte'

  /** The skeleton is part of opening the panel, even when the lyrics are cached. */
  const MIN_LOADING_MS = 1500
  let loadingHold = $state(false)

  // The shell outlives the body, so the opening beat lives here: the header
  // badges and the skeleton then agree instead of the badge popping in first.
  $effect(() => {
    const mode = sidePanel.mode
    if (mode !== 'lyrics') {
      loadingHold = false
      return
    }
    loadingHold = true
    const timer = setTimeout(() => (loadingHold = false), MIN_LOADING_MS)
    return () => clearTimeout(timer)
  })

  const showingLoading = $derived(lyrics.loading || loadingHold)
  const isQueue = $derived(sidePanel.mode === 'queue')
  const isHistory = $derived(sidePanel.mode === 'history')
  const isLyrics = $derived(sidePanel.mode === 'lyrics')
  const modeLabel = $derived(isQueue ? 'Queue' : isHistory ? 'History' : 'Lyrics')
  const count = $derived(isQueue ? player.queue.length : isHistory ? history.entries.length : 0)
</script>

<aside
  class="panel"
  class:open={sidePanel.open}
  aria-hidden={!sidePanel.open}
  aria-label={modeLabel}
>
  <div class="panel-inner">
    <header>
      <span class="eyebrow">{modeLabel}</span>

      {#if isQueue || isHistory}
        <span class="count">{count}</span>
      {:else if !showingLoading && lyrics.data?.kind === 'synced'}
        <span class="sync-badge synced" title="Lyrics follow the track">
          <span class="sync-dot" aria-hidden="true"></span>Synced
        </span>
      {:else if !showingLoading && lyrics.data?.kind === 'plain'}
        <span class="sync-badge" title="Lyrics are not time-synced">
          <span class="sync-dot" aria-hidden="true"></span>Unsynced
        </span>
      {/if}

      {#if isLyrics && !showingLoading && lyrics.data?.source}
        <span class="source">{lyrics.data.source === 'lyrics.ovh' ? 'OVH' : lyrics.data.source}</span>
      {/if}

      <span class="spacer"></span>

      {#if isQueue && player.queue.length > 0}
        <button class="clear" onclick={() => player.clearQueue()}>Clear</button>
      {/if}

      <button
        class="close"
        onclick={() => sidePanel.close()}
        aria-label={`Close ${modeLabel.toLowerCase()}`}
      >
        <Icon name="close" size={15} />
      </button>
    </header>

    <div class="body">
      {#if isLyrics}
        <LyricsPanel {showingLoading} />
      {:else if isQueue}
        <QueuePanel />
      {:else if isHistory}
        <HistoryPanel />
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
       weaker than a raised surface/border treatment: no background step, no
       gutter, just enough contrast to read where the page ends. */
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
    width: calc(var(--panel-w) - 1px);
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

  .count {
    color: var(--text-faint);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
  }

  .spacer {
    flex: 1;
  }

  .clear {
    color: var(--text-dim);
    font-size: 11.5px;
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--stroke);
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .clear:hover {
    background: var(--glass-hover);
    color: var(--text);
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
</style>
