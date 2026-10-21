<script lang="ts">
  import type { SearchFilterName } from '@shared/types'
  import { player } from '../lib/player.svelte'
  import { searchState } from '../lib/search.svelte'
  import { network } from '../lib/network.svelte'
  import TrackRow from './TrackRow.svelte'

  const filters: { id: SearchFilterName; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'songs', label: 'Songs' },
    { id: 'albums', label: 'Albums' },
    { id: 'artists', label: 'Artists' },
    { id: 'playlists', label: 'Playlists' }
  ]

  // State lives in the store, so returning here restores the query and results.
  const items = $derived(searchState.items)
</script>

<div class="view">
  <header class="head">
    <h1>Search</h1>
    {#if searchState.query.trim()}
      <p class="for">
        {network.localFirst ? 'Searching your downloads for ' : 'Results for '}“{searchState.query
          .trim()}”
      </p>
    {/if}
  </header>

  {#if network.localFirst}
    <div class="chips">
      <span class="offline-hint">Offline — only downloaded songs can be found.</span>
      {#if items.length > 0}
        <span class="count">{items.length} downloads</span>
      {/if}
    </div>
  {:else}
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
  {/if}

  {#if searchState.error}
    <div class="notice">
      <strong>Search failed</strong>
      <span>{searchState.error}</span>
    </div>
  {/if}

  {#if searchState.loading && items.length === 0}
    <p class="placeholder">Searching…</p>
  {:else if !searchState.query.trim()}
    <p class="placeholder">
      {network.localFirst
        ? 'Search your downloads by title, artist or album.'
        : 'Search from the bar above — songs, artists, albums and playlists.'}
    </p>
  {:else if items.length === 0}
    <p class="placeholder">
      {network.localFirst ? 'No downloaded songs match' : 'No results for'} “{searchState.query
        .trim()}”.
    </p>
  {:else}
    <ul class="results">
      {#each items as item (item.kind + item.id + item.title)}
        <TrackRow {item} context={[item]} onQueue={(i) => player.enqueue(i)} />
      {/each}
    </ul>
  {/if}
</div>

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

  .offline-hint {
    color: #f0c477;
    font-size: 11.5px;
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
