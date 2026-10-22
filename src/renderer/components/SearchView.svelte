<script lang="ts">
  import type { SearchFilterName } from '@shared/types'
  import { player } from '../lib/player.svelte'
  import { searchState } from '../lib/search.svelte'
  import { network } from '../lib/network.svelte'
  import { nav } from '../lib/nav.svelte'
  import TrackRow from './TrackRow.svelte'

  const filters: { id: SearchFilterName; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'songs', label: 'Songs' },
    { id: 'albums', label: 'Albums' },
    { id: 'artists', label: 'Artists' },
    { id: 'playlists', label: 'Playlists' }
  ]

  // State lives in the store, so returning here restores the query and results.
  // Search needs the catalog and is unavailable while the app is local-first.
  const items = $derived(searchState.visibleItems)
</script>

{#if network.localFirst}
  <div class="offline-page">
    <p class="eyebrow">Offline</p>
    <h1>
      {network.state.status === 'unreachable'
        ? 'Cannot connect to the host right now.'
        : 'You are not connected to the internet.'}
    </h1>
    <p>
      {network.state.status === 'unreachable'
        ? 'Search needs a connection. Your downloads are still available in Library.'
        : 'Reconnect to search songs, albums, artists and playlists. Your downloads are still available in Library.'}
    </p>
    <div class="offline-actions">
      <button class="primary" onclick={() => nav.go('library')}>Open Library</button>
    </div>
  </div>
{:else}
  <div class="view">
    <header class="head">
      <h1>Search</h1>
      {#if searchState.query.trim()}
        <p class="for">Results for “{searchState.query.trim()}”</p>
      {/if}
    </header>

    <div class="chips">
      {#each filters as f (f.id)}
        <button class="chip" class:on={searchState.filter === f.id} onclick={() => searchState.setFilter(f.id)}>
          {f.label}
        </button>
      {/each}
      {#if items.length > 0}
        <span class="count">{items.length} results</span>
      {/if}
    </div>

    {#if searchState.error}
      <div class="notice">
        <strong>Search failed</strong>
        <span>{searchState.error}</span>
      </div>
    {/if}

    {#if searchState.loading && items.length === 0}
      <p class="placeholder">Searching…</p>
    {:else if !searchState.query.trim()}
      <p class="placeholder">Search from the bar above — songs, artists, albums and playlists.</p>
    {:else if items.length === 0}
      <p class="placeholder">No results for “{searchState.query.trim()}”.</p>
    {:else}
      <ul class="results">
        {#each items as item (item.kind + item.id + item.title)}
          <TrackRow {item} context={[item]} onQueue={(i) => player.enqueue(i)} />
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-bottom: 16px;
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding-top: 4px;
  }

  h1 {
    font-size: 30px;
    font-weight: 640;
    margin: 0;
    letter-spacing: -0.028em;
  }

  .for {
    margin: 0;
    font-size: 12.5px;
    color: var(--text-faint);
  }

  .chips {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .offline-page {
    max-width: 560px;
    padding: 48px 0;
  }

  .eyebrow {
    margin: 0 0 10px;
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .offline-page h1 {
    margin: 0 0 10px;
    font-size: clamp(24px, 3vw, 34px);
    letter-spacing: -0.035em;
  }

  .offline-page > p:not(.eyebrow) {
    margin: 0;
    max-width: 460px;
    color: var(--text-dim);
    font-size: 14px;
    line-height: 1.55;
  }

  .offline-actions {
    display: flex;
    gap: 8px;
    margin-top: 20px;
  }

  .primary {
    height: 34px;
    padding: 0 15px;
    border-radius: 999px;
    background: var(--accent);
    color: #08080b;
    font-size: 12.5px;
    font-weight: 600;
  }

  .primary:hover {
    background: var(--accent-strong);
  }

  .chip {
    border: 1px solid var(--stroke);
    border-radius: 999px;
    padding: 5px 13px;
    font-size: 12px;
    color: var(--text-dim);
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease),
      border-color var(--speed) var(--ease);
  }

  .chip:hover {
    color: var(--text);
    border-color: var(--stroke-strong);
  }

  .chip.on {
    background: var(--text);
    border-color: transparent;
    color: #08080b;
  }

  .count {
    margin-left: auto;
    font-size: 11.5px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }

  .results {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .notice {
    display: flex;
    flex-direction: column;
    gap: 3px;
    border-radius: var(--radius-lg);
    padding: 11px 14px;
    font-size: 13px;
    border: 1px solid rgba(255, 128, 128, 0.28);
    background: rgba(255, 128, 128, 0.08);
  }

  .notice span {
    color: var(--text-dim);
    font-size: 12.5px;
  }

  .placeholder {
    color: var(--text-faint);
    font-size: 13px;
    padding: 8px 2px;
  }
</style>
