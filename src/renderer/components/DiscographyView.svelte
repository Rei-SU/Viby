<script lang="ts">
  import type { BrowseResult, CatalogItem } from '@shared/types'
  import { api } from '../lib/api'
  import { artistReleaseGroups, type ArtistRelease } from '../lib/artist-releases'
  import { cachedDetail, cacheDetail } from '../lib/catalog-cache.svelte'
  import { nav } from '../lib/nav.svelte'
  import { network } from '../lib/network.svelte'
  import DiscographyRelease from './DiscographyRelease.svelte'
  import Icon from './Icon.svelte'
  import InlineAlert from './InlineAlert.svelte'
  import MediaCard from './MediaCard.svelte'

  type ViewMode = 'list' | 'grid'
  const VIEW_KEY = 'viby:discography-view'

  /** Spotify defaults to the expanding list; remember the choice once changed. */
  function storedView(): ViewMode {
    try {
      return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
    } catch {
      return 'list'
    }
  }

  let { artist }: { artist: CatalogItem } = $props()

  type Filter = 'all' | 'albums' | 'singles'

  let result = $state<BrowseResult | null>(null)
  let loading = $state(true)
  let error = $state<string | null>(null)
  let filter = $state<Filter>('all')
  let view = $state<ViewMode>(storedView())
  let retryKey = $state(0)

  function setView(mode: ViewMode): void {
    view = mode
    try {
      localStorage.setItem(VIEW_KEY, mode)
    } catch {
      // A locked-down profile just forgets the preference.
    }
  }

  const browseId = $derived(artist.browseId ?? artist.id)
  const pageArtist = $derived({ name: artist.title, id: artist.browseId ?? artist.id })
  const groups = $derived(artistReleaseGroups(result?.shelves ?? []))
  const releases = $derived<ArtistRelease[]>(
    filter === 'albums' ? groups.albums : filter === 'singles' ? groups.singles : groups.all
  )
  const filters = $derived(
    [
      { id: 'all' as const, label: 'All', count: groups.all.length },
      { id: 'albums' as const, label: 'Albums', count: groups.albums.length },
      { id: 'singles' as const, label: 'Singles and EPs', count: groups.singles.length }
    ].filter((entry) => entry.id === 'all' || entry.count > 0)
  )

  $effect(() => {
    const id = browseId
    retryKey

    const cached = cachedDetail(id)
    if (cached) {
      result = cached
      loading = false
      error = null
      return
    }
    if (network.localFirst) {
      loading = false
      error = 'Connect to load the full discography.'
      return
    }

    let alive = true
    loading = true
    error = null
    void api.catalog.browse(id).then((res) => {
      if (!alive) return
      loading = false
      if (res.ok) {
        result = res.data
        cacheDetail(id, res.data)
      } else {
        error = res.error
      }
    })

    return () => {
      alive = false
    }
  })

  function retry(): void {
    retryKey += 1
  }

  function activate(item: CatalogItem): void {
    nav.open(item)
  }
</script>

<div class="view">
  <header class="head">
    <h1>Discography</h1>
    <p class="meta">
      {artist.title}
      {#if groups.all.length > 0}
        <span class="sep">·</span>
        <span>{groups.all.length} releases</span>
        <span class="sep">·</span>
        <span>Newest first</span>
      {/if}
    </p>
  </header>

  {#if error}
    <InlineAlert
      title="Could not load the discography"
      message={error}
      actionLabel="Try again"
      onAction={retry}
    />
  {:else if loading}
    <p class="placeholder">Loading releases…</p>
  {:else}
    <div class="toolbar">
      <div class="filters" role="tablist" aria-label="Release type">
        {#each filters as entry (entry.id)}
          <button
            class="filter"
            class:on={filter === entry.id}
            role="tab"
            aria-selected={filter === entry.id}
            onclick={() => (filter = entry.id)}
          >
            {entry.label}
            <span class="count">{entry.count}</span>
          </button>
        {/each}
      </div>

      <div class="views" role="group" aria-label="View">
        <button
          class="view-btn"
          class:on={view === 'list'}
          aria-pressed={view === 'list'}
          aria-label="List view"
          title="List view"
          onclick={() => setView('list')}
        >
          <Icon name="list" size={15} />
        </button>
        <button
          class="view-btn"
          class:on={view === 'grid'}
          aria-pressed={view === 'grid'}
          aria-label="Grid view"
          title="Grid view"
          onclick={() => setView('grid')}
        >
          <Icon name="grid" size={15} />
        </button>
      </div>
    </div>

    {#if releases.length === 0}
      <p class="placeholder">No releases here yet.</p>
    {:else if view === 'list'}
      <div class="releases">
        {#each releases as release, i (release.item.id)}
          <DiscographyRelease {release} divided={i > 0} fallbackArtist={pageArtist} />
        {/each}
      </div>
    {:else}
      <div class="grid">
        {#each releases as release (release.item.id)}
          <MediaCard item={release.item} size={150} onActivate={activate} />
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 1080px;
    padding: 4px 2px 32px;
  }

  h1 {
    margin: 0;
    font-size: 30px;
    font-weight: 660;
    letter-spacing: -0.03em;
  }

  .meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 7px;
    margin: 6px 0 0;
    color: var(--text-faint);
    font-size: 12.5px;
  }

  .sep {
    opacity: 0.6;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }

  .views {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--stroke);
    border-radius: 8px;
    flex-shrink: 0;
  }

  .view-btn {
    display: grid;
    place-items: center;
    width: 28px;
    height: 24px;
    border-radius: 6px;
    color: var(--text-faint);
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .view-btn:hover {
    color: var(--text);
  }

  .view-btn.on {
    background: var(--glass-active);
    color: var(--text);
  }

  .releases {
    display: flex;
    flex-direction: column;
    padding-top: 2px;
  }

  .filter {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 11px;
    border: 1px solid var(--stroke);
    border-radius: 999px;
    color: var(--text-dim);
    font-size: 11.5px;
    transition:
      background var(--speed) var(--ease),
      border-color var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .filter:hover {
    border-color: var(--stroke-strong);
    color: var(--text);
  }

  .filter.on {
    border-color: var(--stroke-strong);
    background: var(--glass-active);
    color: var(--text);
  }

  .count {
    color: var(--text-faint);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .filter.on .count {
    color: var(--text-dim);
  }

  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 20px 15px;
    padding-top: 4px;
  }

  .placeholder {
    margin: 0;
    color: var(--text-faint);
    font-size: 13px;
  }
</style>
