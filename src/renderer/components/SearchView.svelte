<script lang="ts">
  import type { CatalogItem, SearchFilterName } from '@shared/types'
  import { onDestroy, onMount } from 'svelte'
  import { player } from '../lib/player.svelte'
  import { searchState } from '../lib/search.svelte'
  import { network } from '../lib/network.svelte'
  import { nav } from '../lib/nav.svelte'
  import { openArtist } from '../lib/artist'
  import { lyrics } from '../lib/lyrics.svelte'
  import { fitRail } from '../lib/rail-fit'
  import TrackRow from './TrackRow.svelte'
  import MediaCard from './MediaCard.svelte'
  import SubtitleParts from './SubtitleParts.svelte'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'
  import InlineAlert from './InlineAlert.svelte'

  const filters: { id: SearchFilterName; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'songs', label: 'Songs' },
    { id: 'albums', label: 'Albums' },
    { id: 'artists', label: 'Artists' },
    { id: 'playlists', label: 'Playlists' }
  ]

  let recents = $state<string[]>([])

  // Freeze the card grid's column count while the lyrics panel animates so the
  // auto-fill breakpoints do not reflow mid-transition (which reads as jitter).
  // Cards have fixed widths, so changing the track count never resizes a card.
  // Opening freezes to the final (narrower) count; closing keeps the current
  // count until the extra space is available, then reflows once.
  // Applied directly to the DOM (not via reactive state) so it lands in the
  // same frame as the panel toggle, avoiding a one-frame flash.
  let freezeTimer: ReturnType<typeof setTimeout> | null = null
  let prevLyricsOpen = lyrics.open

  $effect.pre(() => {
    const open = lyrics.open
    if (open === prevLyricsOpen) return
    prevLyricsOpen = open
    if (freezeTimer) clearTimeout(freezeTimer)
    const grid = document.querySelector<HTMLElement>('.card-grid')
    if (!grid) return
    // `--lyrics-w` is clamp(320px, 30vw, 380px). Resolve it here instead of
    // parsing the custom property, which can keep the clamp() token stream.
    const panelW = Math.min(380, Math.max(320, window.innerWidth * 0.3))
    const gridW = grid.getBoundingClientRect().width
    const card = grid.querySelector<HTMLElement>('.card')
    const cardW = card?.getBoundingClientRect().width || 152
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 16
    const columnsFor = (width: number): number => Math.max(1, Math.floor((width + gap) / (cardW + gap)))
    // On open, switch to the final narrower count immediately. On close, hold
    // the current count; switching to the wider count before the page has room
    // would overflow horizontally.
    const cols = open ? columnsFor(gridW - panelW) : columnsFor(gridW)
    for (const g of document.querySelectorAll<HTMLElement>('.card-grid')) {
      g.style.gridTemplateColumns = `repeat(${cols}, ${cardW}px)`
    }
    freezeTimer = setTimeout(() => {
      for (const g of document.querySelectorAll<HTMLElement>('.card-grid')) {
        g.style.gridTemplateColumns = ''
      }
      freezeTimer = null
    }, 340)
  })

  function loadRecents(): void {
    try {
      const parsed = JSON.parse(localStorage.getItem('viby.recentSearches') ?? '[]')
      if (Array.isArray(parsed)) {
        recents = parsed.filter((item): item is string => typeof item === 'string').slice(0, 8)
      }
    } catch {
      recents = []
    }
  }

  onMount(() => loadRecents())
  onDestroy(() => {
    if (freezeTimer) clearTimeout(freezeTimer)
  })

  // Keep the recent list in sync with the titlebar search.
  $effect(() => {
    void searchState.query
    loadRecents()
  })

  const items = $derived(searchState.visibleItems)
  const songs = $derived(items.filter((item) => item.kind === 'song'))
  const artists = $derived(items.filter((item) => item.kind === 'artist'))
  const albums = $derived(items.filter((item) => item.kind === 'album'))
  const playlists = $derived(items.filter((item) => item.kind === 'playlist'))
  const top = $derived(items[0] ?? null)
  const songRows = $derived(
    top && top.kind === 'song' ? songs.filter((item) => item !== top).slice(0, 5) : songs.slice(0, 5)
  )

  function activate(item: CatalogItem): void {
    if (item.kind === 'song') {
      void player.playItem(item)
    } else if (item.kind === 'artist') {
      openArtist(item.id, item.title, item.thumbnail)
    } else {
      nav.open(item)
    }
  }

  function showAll(filter: SearchFilterName): void {
    searchState.setFilter(filter)
  }

  function useRecent(query: string): void {
    searchState.setQuery(query)
    searchState.submit('all')
  }
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

    {#if !searchState.query.trim()}
      {#if recents.length > 0}
        <section class="recents">
          <h2>Recent searches</h2>
          <div class="recent-chips">
            {#each recents as query (query)}
              <button class="recent-chip" onclick={() => useRecent(query)}>{query}</button>
            {/each}
          </div>
        </section>
      {/if}
      <div class="empty-state">
        <p>Search for songs, artists, albums, and playlists.</p>
      </div>
    {:else}
      <div class="chips">
        {#each filters as f (f.id)}
          <button class="chip" class:on={searchState.filter === f.id} onclick={() => searchState.setFilter(f.id)}>
            {f.label}
          </button>
        {/each}
      </div>

      {#if searchState.loading && items.length === 0}
        <p class="placeholder">Searching…</p>
      {:else if searchState.error && items.length === 0}
        <div class="search-alert">
          <InlineAlert
            title="Search failed"
            message={searchState.error}
            actionLabel="Try again"
            onAction={() => void searchState.load()}
          />
        </div>
      {:else if items.length === 0}
        <p class="placeholder">No results for “{searchState.query.trim()}”.</p>
      {:else if searchState.filter !== 'all'}
        <div class="section-head">
          <h2>{filters.find((f) => f.id === searchState.filter)?.label ?? 'Results'}</h2>
          <span class="count">{items.length} results</span>
        </div>
        {#if searchState.filter === 'songs'}
          <ul class="results">
            {#each items as item (item.kind + item.id + item.title)}
              <TrackRow
                {item}
                context={items}
                contextIndex={items.indexOf(item)}
                onQueue={(i) => player.enqueue(i)}
              />
            {/each}
          </ul>
        {:else}
          <div class="card-grid">
            {#each items as item (item.kind + item.id + item.title)}
              <MediaCard
                item={item}
                size={152}
                onActivate={() => activate(item)}
              />
            {/each}
          </div>
        {/if}
      {:else}
        {#if top}
          <section class="top-result">
            <h2>Top result</h2>
            <div class="top-card">
              <button
                type="button"
                class="top-hit"
                aria-label={top.kind === 'song' ? `Play ${top.title}` : `Open ${top.title}`}
                title={top.title}
                onclick={() => activate(top)}
              ></button>
              <Cover src={top.thumbnail} size={96} radius={top.kind === 'artist' ? 48 : 12} alt={top.title} />
              <div class="top-meta">
                <span class="top-type">{top.releaseType ?? top.kind}</span>
                <span class="top-title">{top.title}</span>
                <span class="top-sub">
                  <SubtitleParts
                    parts={top.parts}
                    fallback={top.subtitle}
                    linkPlainArtists={top.kind === 'playlist'}
                  />
                </span>
              </div>
              {#if top.kind === 'song'}
                <span class="top-play"><Icon name="play" size={18} solid /></span>
              {/if}
            </div>
          </section>
        {/if}

        {#if songs.length > 0}
          <section class="section">
            <div class="section-head">
              <h2>Songs</h2>
              {#if songs.length > 5}
                <button class="show-all" onclick={() => showAll('songs')}>Show all</button>
              {/if}
            </div>
            <ul class="results">
              {#each songRows as item (item.kind + item.id + item.title)}
                <TrackRow
                  {item}
                  context={songs}
                  contextIndex={songs.indexOf(item)}
                  onQueue={(i) => player.enqueue(i)}
                />
              {/each}
            </ul>
          </section>
        {/if}

        {#if artists.length > 0}
          <section class="section">
            <div class="section-head">
              <h2>Artists</h2>
              {#if artists.length > 6}
                <button class="show-all" onclick={() => showAll('artists')}>Show all</button>
              {/if}
            </div>
            <div class="rail" use:fitRail>
              {#each artists.slice(0, 6) as item (item.kind + item.id + item.title)}
                <MediaCard item={item} size={152} onActivate={() => activate(item)} />
              {/each}
            </div>
          </section>
        {/if}

        {#if albums.length > 0}
          <section class="section">
            <div class="section-head">
              <h2>Albums</h2>
              {#if albums.length > 6}
                <button class="show-all" onclick={() => showAll('albums')}>Show all</button>
              {/if}
            </div>
            <div class="rail" use:fitRail>
              {#each albums.slice(0, 6) as item (item.kind + item.id + item.title)}
                <MediaCard item={item} size={152} onActivate={() => activate(item)} />
              {/each}
            </div>
          </section>
        {/if}

        {#if playlists.length > 0}
          <section class="section">
            <div class="section-head">
              <h2>Playlists</h2>
              {#if playlists.length > 6}
                <button class="show-all" onclick={() => showAll('playlists')}>Show all</button>
              {/if}
            </div>
            <div class="rail" use:fitRail>
              {#each playlists.slice(0, 6) as item (item.kind + item.id + item.title)}
                <MediaCard item={item} size={152} onActivate={() => activate(item)} />
              {/each}
            </div>
          </section>
        {/if}
      {/if}
    {/if}
  </div>
{/if}

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 28px;
    padding-bottom: 24px;
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: 4px;
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

  .recents {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .recents h2 {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    letter-spacing: -0.012em;
  }

  .recent-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .recent-chip {
    border: 1px solid var(--stroke);
    border-radius: 999px;
    padding: 6px 14px;
    font-size: 12.5px;
    color: var(--text-dim);
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease),
      border-color var(--speed) var(--ease);
  }

  .recent-chip:hover {
    color: var(--text);
    border-color: var(--stroke-strong);
    background: var(--glass-hover);
  }

  .empty-state {
    padding: 48px 0;
    color: var(--text-faint);
    font-size: 13px;
  }

  .search-alert {
    margin-top: 18px;
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

  .top-result {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .top-result h2 {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    letter-spacing: -0.012em;
  }

  .top-card {
    position: relative;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
    border-radius: var(--radius-lg);
    background: var(--glass);
    border: 1px solid var(--stroke);
    text-align: left;
    transition:
      background var(--speed) var(--ease),
      border-color var(--speed) var(--ease),
      transform var(--speed) var(--ease);
  }

  .top-hit {
    position: absolute;
    inset: 0;
    z-index: 0;
    border-radius: var(--radius-lg);
  }

  .top-card > :not(.top-hit) {
    position: relative;
    z-index: 1;
    pointer-events: none;
  }

  .top-card:hover {
    background: var(--glass-hover);
    border-color: var(--stroke-strong);
    transform: translateY(-1px);
  }

  .top-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .top-type {
    font-size: 10.5px;
    font-weight: 550;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-faint);
  }

  .top-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
    letter-spacing: -0.01em;
  }

  .top-sub {
    font-size: 12.5px;
    color: var(--text-dim);
  }

  .top-play {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--text);
    color: #08080b;
    flex-shrink: 0;
    transition: transform var(--speed) var(--ease);
  }

  .top-card:hover .top-play {
    transform: scale(1.05);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .section-head h2 {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    letter-spacing: -0.012em;
  }

  .show-all {
    font-size: 12px;
    color: var(--text-dim);
    transition: color var(--speed) var(--ease);
  }

  .show-all:hover {
    color: var(--text);
  }

  .card-grid {
    display: grid;
    /* Fixed tracks keep card sizes constant while the lyrics sidebar animates.
       Fluid 1fr tracks resize every card on every frame, which reads as jitter. */
    grid-template-columns: repeat(auto-fill, 152px);
    gap: 20px 16px;
    justify-content: start;
    align-items: start;
  }

  /* The "All" result categories stay on one row and scroll sideways, matching
     Home and artist pages. Only the filtered "Show all" views use a grid. */
  .rail {
    display: flex;
    gap: 18px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 2px 4px 8px;
    margin: -2px -4px 0;
    min-width: 0;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
  }

  .rail::-webkit-scrollbar {
    height: 8px;
  }

  .rail::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 999px;
  }

  .results {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .placeholder {
    color: var(--text-faint);
    font-size: 13px;
    padding: 8px 2px;
  }
</style>
