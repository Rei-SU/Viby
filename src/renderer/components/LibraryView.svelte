<script lang="ts">
  import type { CatalogItem, Track } from '@shared/types'
  import { api } from '../lib/api'
  import { playlists } from '../lib/playlists.svelte'
  import { downloads } from '../lib/downloads.svelte'
  import { savedAlbums } from '../lib/saved-albums.svelte'
  import { network } from '../lib/network.svelte'
  import { nav } from '../lib/nav.svelte'
  import { artwork } from '../lib/artwork.svelte'
  import { buildLibraryItems, type LibraryItem } from '../lib/library-items'
  import {
    entryToItem,
    formatSize,
    standaloneEntries
  } from '../lib/download-groups'
  import Cover from './Cover.svelte'
  import DownloadBadge from './DownloadBadge.svelte'
  import Icon from './Icon.svelte'
  import TrackRow from './TrackRow.svelte'

  type Filter = 'all' | 'playlists' | 'albums' | 'downloaded'

  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'playlists', label: 'Playlists' },
    { id: 'albums', label: 'Albums' },
    { id: 'downloaded', label: 'Downloaded' }
  ]

  let favorites = $state<Track[]>([])
  let creating = $state(false)
  let name = $state('')
  let filter = $state<Filter>('all')

  const items = $derived(
    buildLibraryItems(
      favorites,
      playlists.items,
      savedAlbums.items,
      downloads.collections,
      downloads.entries
    )
  )
  const visible = $derived(
    items.filter((item) => {
      if (filter === 'all') return true
      if (filter === 'playlists') return item.kind === 'liked' || item.kind === 'playlist'
      if (filter === 'albums') return item.kind === 'album'
      return item.mark !== 'none'
    })
  )
  const loose = $derived(standaloneEntries(downloads.collections, downloads.entries))
  const looseSongs = $derived(
    loose.map((entry) => ({ entry, item: entryToItem(entry, downloads.collections) }))
  )
  const looseItems = $derived(looseSongs.map((song) => song.item))
  const looseBytes = $derived(loose.reduce((sum, entry) => sum + entry.bytes, 0))

  const showNew = $derived(filter === 'all' || filter === 'playlists')
  const showSongs = $derived((filter === 'all' || filter === 'downloaded') && loose.length > 0)
  const empty = $derived(visible.length === 0 && !showNew && !showSongs)

  $effect(() => {
    void playlists.load(true)
    void savedAlbums.load(true)
    void loadFavorites()
  })

  // Warm the covers of what this view actually shows. Warming every saved
  // playlist's tracks queued thousands of images the user never saw.
  $effect(() => {
    artwork.warm([
      ...items.map((item) => item.art),
      ...favorites.map((track) => track.thumbnail)
    ])
  })

  async function loadFavorites(): Promise<void> {
    favorites = await api.favorites.list()
  }

  async function create(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (!name.trim()) return
    const playlist = await playlists.create(name)
    name = ''
    creating = false
    nav.openCollection({ kind: 'playlist', id: playlist.id })
  }

  async function removeSong(item: CatalogItem): Promise<void> {
    if (!window.confirm(`Remove the download for “${item.title}”?`)) return
    await downloads.removeTrack(item.id)
  }

  function openItem(entry: LibraryItem): void {
    if (!entry.album) {
      nav.openCollection(entry.ref)
      return
    }
    // A downloaded saved album can open its local-first page offline; otherwise
    // the normal release page (which needs the catalogue) is the destination.
    if (network.localFirst && entry.mark !== 'none') {
      nav.openCollection(entry.ref)
      return
    }
    nav.open({
      id: entry.album.id,
      browseId: entry.album.id,
      kind: 'album',
      title: entry.album.title,
      subtitle: entry.album.artist ?? 'Album',
      thumbnail: entry.album.thumbnail,
      releaseType: entry.album.releaseType
    })
  }
</script>

<div class="view">
  <header class="head">
    <div>
      <h1>Library</h1>
      <p>Saved on this device. Downloaded items are badged and play offline.</p>
    </div>
    <div class="filters" role="toolbar" aria-label="Library filters">
      {#each FILTERS as option (option.id)}
        <button
          class="chip"
          class:on={filter === option.id}
          aria-pressed={filter === option.id}
          onclick={() => (filter = option.id)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  </header>

  {#if visible.length > 0 || showNew}
    <div class="grid">
      {#each visible as item (item.id)}
        <button class="tile" onclick={() => openItem(item)}>
          <span class="art-wrap">
            {#if item.kind === 'liked'}
              <span class="art liked">
                <Icon name="heart" size={44} solid />
              </span>
            {:else}
              <Cover src={artwork.src(item.art)} size={152} radius={12} alt={item.title} />
            {/if}
            <span class="badge-slot">
              <DownloadBadge mark={item.mark} progress={item.progress} />
            </span>
          </span>
          <span class="tile-title truncate">{item.title}</span>
          <span class="tile-sub truncate">{item.subtitle}</span>
        </button>
      {/each}

      {#if showNew}
        {#if creating}
          <form class="tile new" onsubmit={create}>
            <input bind:value={name} placeholder="Playlist name" aria-label="Playlist name" />
            <div class="new-actions">
              <button type="submit" class="primary" disabled={!name.trim()}>Create</button>
              <button
                type="button"
                class="ghost"
                onclick={() => {
                  creating = false
                  name = ''
                }}>Cancel</button
              >
            </div>
          </form>
        {:else}
          <button class="tile" onclick={() => (creating = true)}>
            <span class="art add">
              <Icon name="plus" size={28} />
            </span>
            <span class="tile-title">New playlist</span>
            <span class="tile-sub">Start from scratch</span>
          </button>
        {/if}
      {/if}
    </div>
  {/if}

  {#if empty}
    <div class="empty">
      <Icon name="download" size={26} />
      <p class="empty-title">
        {filter === 'albums' ? 'No albums yet' : 'Nothing downloaded yet'}
      </p>
      <p>
        {#if filter === 'albums'}
          Save an album, EP or single from its page, or download one to keep it here for offline
          listening.
        {:else}
          Use the download button on any song, album or playlist to keep it available offline.
        {/if}
      </p>
    </div>
  {/if}

  {#if showSongs}
    <section class="songs">
      <div class="section-head">
        <h2>Downloaded songs</h2>
        <span>
          {loose.length} {loose.length === 1 ? 'song' : 'songs'} · {formatSize(looseBytes)}
        </span>
      </div>
      <ul class="rows">
        {#each looseSongs as { entry, item }, i (entry.track.id)}
          <TrackRow
            {item}
            context={looseItems}
            index={i}
            showIndex={false}
            showDownload={false}
            meta={formatSize(entry.bytes)}
            onRemove={removeSong}
          />
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 4px 2px 20px;
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  h1 {
    font-size: 30px;
    font-weight: 640;
    margin: 0 0 4px;
    letter-spacing: -0.028em;
  }

  .head p {
    margin: 0;
    color: var(--text-faint);
    font-size: 12.5px;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }

  .chip {
    height: 30px;
    padding: 0 13px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.05);
    box-shadow: inset 0 0 0 1px var(--stroke);
    color: var(--text-dim);
    font-size: 12px;
    font-weight: 500;
  }

  .chip:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .chip.on {
    background: var(--text);
    color: #08080b;
    box-shadow: none;
  }

  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 152px;
    text-align: left;
  }

  .tile:hover .art-wrap {
    transform: translateY(-3px);
  }

  .tile:hover .art-wrap :global(img),
  .tile:hover .art {
    box-shadow: var(--shadow-card);
  }

  .art-wrap {
    position: relative;
    width: 152px;
    height: 152px;
    transition: transform var(--speed) var(--ease);
  }

  .art {
    width: 152px;
    height: 152px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    transition:
      transform var(--speed) var(--ease),
      box-shadow var(--speed) var(--ease);
  }

  .liked {
    color: var(--text);
    background: linear-gradient(145deg, #26262e, #141419);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  }

  .add {
    color: var(--text-faint);
    background: rgba(255, 255, 255, 0.03);
    box-shadow: inset 0 0 0 1px var(--stroke);
  }

  .tile:hover .add {
    color: var(--text);
    background: var(--glass-hover);
  }

  .badge-slot {
    position: absolute;
    right: 8px;
    bottom: 8px;
    display: flex;
  }

  .tile-title {
    font-size: 13px;
    font-weight: 500;
    margin-top: 4px;
    max-width: 152px;
  }

  .tile-sub {
    font-size: 11.5px;
    color: var(--text-faint);
    max-width: 152px;
  }

  .new {
    justify-content: flex-start;
    gap: 8px;
  }

  .new input {
    width: 152px;
    height: 152px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--stroke);
    border-radius: 12px;
    color: var(--text);
    padding: 12px;
    outline: none;
    font-size: 13px;
    text-align: left;
    vertical-align: top;
  }

  .new input:focus {
    border-color: var(--stroke-strong);
  }

  .new-actions {
    display: flex;
    gap: 6px;
  }

  .primary {
    flex: 1;
    background: var(--text);
    color: #08080b;
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 12px;
    font-weight: 550;
  }

  .primary:disabled {
    background: var(--glass-active);
    color: var(--text-faint);
  }

  .ghost {
    border: 1px solid var(--stroke);
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .ghost:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 22px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.025);
    box-shadow: inset 0 0 0 1px var(--stroke);
    color: var(--text-faint);
    font-size: 12.5px;
  }

  .empty-title {
    color: var(--text);
    font-size: 14px;
    font-weight: 550;
  }

  .empty p {
    margin: 0;
  }

  .songs {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  h2 {
    font-size: 17px;
    font-weight: 600;
    margin: 0;
    letter-spacing: -0.01em;
  }

  .section-head span {
    color: var(--text-faint);
    font-size: 11.5px;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
</style>
