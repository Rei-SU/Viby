<script lang="ts">
  import type { SearchFilterName } from '@shared/types'
  import { player } from '../lib/player.svelte'
  import { searchState } from '../lib/search.svelte'
  import TrackRow from './TrackRow.svelte'
  import Icon from './Icon.svelte'

  const filters: { id: SearchFilterName; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'songs', label: 'Songs' },
    { id: 'albums', label: 'Albums' },
    { id: 'artists', label: 'Artists' },
    { id: 'playlists', label: 'Playlists' }
  ]

  // State lives in the store, so returning here restores the query and results.
  const items = $derived(searchState.items)

  function onInput(event: Event): void {
    searchState.setQuery((event.currentTarget as HTMLInputElement).value)
  }
</script>

<div class="view">
  <header class="head">
    <h1>Search</h1>
    <div class="searchbox glass">
      <Icon name="search" size={17} />
      <input
        type="text"
        value={searchState.query}
        oninput={onInput}
        placeholder="Songs, artists, albums, playlists…"
        spellcheck="false"
        autocomplete="off"
        aria-label="Search"
      />
      {#if searchState.loading}
        <span class="pip"></span>
      {/if}
    </div>
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
    <p class="placeholder">Search the catalogue — songs, artists, albums and playlists.</p>
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
    gap: 14px;
    padding-top: 4px;
  }

  h1 {
    font-size: 30px;
    font-weight: 640;
    margin: 0;
    letter-spacing: -0.028em;
  }

  .searchbox {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    height: 44px;
    border-radius: 12px;
    color: var(--text-faint);
    max-width: 620px;
    transition: border-color var(--speed) var(--ease);
  }

  .searchbox:focus-within {
    border-color: var(--stroke-strong);
    color: var(--text-dim);
  }

  .searchbox input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font-size: 13.5px;
  }

  .searchbox input::placeholder {
    color: var(--text-faint);
  }

  .pip {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 1;
    }
  }

  .chips {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
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
