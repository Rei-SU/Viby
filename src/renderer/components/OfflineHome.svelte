<script lang="ts">
  import type { CatalogItem, DownloadCollection } from '@shared/types'
  import { downloads } from '../lib/downloads.svelte'
  import { network } from '../lib/network.svelte'
  import { player } from '../lib/player.svelte'
  import { nav } from '../lib/nav.svelte'
  import {
    collectionItems,
    entryToItem,
    formatSize as size,
    standaloneEntries
  } from '../lib/download-groups'
  import MediaCard from './MediaCard.svelte'
  import Rail from './Rail.svelte'
  import TrackRow from './TrackRow.svelte'
  import Icon from './Icon.svelte'

  const entries = $derived(downloads.entries)
  const collections = $derived(downloads.collections)
  const stats = $derived(downloads.stats)

  const collectionGroups = $derived.by(() =>
    collections
      .map((collection) => ({
        collection,
        items: collectionItems(collection, entries)
      }))
      .filter((group) => group.items.length > 0)
  )

  const albums = $derived(collectionGroups.filter((group) => group.collection.kind === 'album'))
  const playlists = $derived(collectionGroups.filter((group) => group.collection.kind !== 'album'))

  const allItems = $derived(entries.map((entry) => entryToItem(entry, collections)))
  const recent = $derived(allItems.slice(0, 8))
  const standalone = $derived(
    standaloneEntries(collections, entries).map((entry) => entryToItem(entry, collections))
  )

  const title = $derived(
    network.state.forcedOffline
      ? 'Offline mode'
      : network.state.status === 'unreachable'
        ? 'Cannot connect to the host'
        : "You're offline"
  )

  function collectionItem(collection: DownloadCollection, tracks: CatalogItem[]): CatalogItem {
    return {
      id: collection.key,
      browseId: collection.key,
      kind: collection.kind === 'album' ? 'album' : 'playlist',
      title: collection.title,
      subtitle: `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}`,
      thumbnail: collection.artUrl ?? collection.thumbnail
    }
  }

  function openCollection(collection: DownloadCollection): void {
    nav.openCollection({ kind: 'download', key: collection.key })
  }

  function playCollection(tracks: CatalogItem[]): void {
    if (tracks.length > 0) void player.playList(tracks, 0)
  }

  function playAll(): void {
    if (allItems.length > 0) void player.playList(allItems, 0)
  }
</script>

<div class="view">
  <header class="head">
    <div class="status">
      <span class="dot" class:forced={network.state.forcedOffline}></span>
      <span>{title}</span>
    </div>
    <h1>Ready when you are.</h1>
    <p>
      {#if entries.length > 0}
        {entries.length} downloaded {entries.length === 1 ? 'song' : 'songs'} · {size(stats?.bytes)}
        · {stats?.freeBytes != null ? `${size(stats.freeBytes)} free` : 'free space unavailable'}
      {:else}
        {network.detail || 'Downloads are the only things that play without a connection.'}
      {/if}
    </p>
    <div class="actions">
      <button class="primary" disabled={entries.length === 0} onclick={playAll}>
        <Icon name="play" size={13} solid /> Play downloads
      </button>
      <button class="secondary" onclick={() => nav.go('library')}>Manage downloads</button>
      {#if network.state.forcedOffline}
        <button class="secondary" onclick={() => void network.setMode('auto')}>Go online</button>
      {/if}
    </div>
  </header>

  {#if entries.length === 0}
    <section class="empty">
      <div class="empty-art"><Icon name="download" size={26} /></div>
      <div>
        <h2>Nothing downloaded yet</h2>
        <p>
          Download songs, albums, playlists or Liked songs while online. They stay on this
          device and play with no connection.
        </p>
        {#if network.state.forcedOffline}
          <button class="secondary" onclick={() => void network.setMode('auto')}>
            Go online to download
          </button>
        {:else}
          <button class="secondary" onclick={() => nav.go('search')}>Find something</button>
        {/if}
      </div>
    </section>
  {:else}
    {#if recent.length > 0}
      <Rail title="Continue listening">
        {#snippet action()}
          <button class="link" onclick={() => nav.go('library')}>See all</button>
        {/snippet}
        {#each recent as item (item.id)}
          <MediaCard {item} onActivate={() => playCollection([item])} />
        {/each}
      </Rail>
    {/if}

    {#if albums.length > 0}
      <Rail title="Albums">
        {#each albums as group (group.collection.key)}
          <MediaCard
            item={collectionItem(group.collection, group.items)}
            onActivate={() => openCollection(group.collection)}
          />
        {/each}
      </Rail>
    {/if}

    {#if playlists.length > 0}
      <Rail title="Playlists">
        {#each playlists as group (group.collection.key)}
          <MediaCard
            item={collectionItem(group.collection, group.items)}
            onActivate={() => openCollection(group.collection)}
          />
        {/each}
      </Rail>
    {/if}

    {#if standalone.length > 0}
      <section class="shelf">
        <div class="shelf-head">
          <h2>Songs</h2>
          <button class="link" onclick={() => nav.go('library')}>Manage</button>
        </div>
        <ul class="rows">
          {#each standalone.slice(0, 8) as item, index (item.id)}
            <TrackRow {item} {index} context={standalone} showDownload={false} />
          {/each}
        </ul>
        {#if standalone.length > 8}
          <button class="link more" onclick={() => nav.go('library')}>
            {standalone.length - 8} more in Library
          </button>
        {/if}
      </section>
    {/if}
  {/if}
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 30px;
    padding-bottom: 16px;
  }

  .head {
    padding-top: 4px;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 10px;
    color: #f0c477;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #f0c477;
    box-shadow: 0 0 0 3px rgba(240, 196, 119, 0.12);
  }

  .dot.forced {
    background: #f0c477;
  }

  .head h1 {
    margin: 0 0 7px;
    font-size: clamp(28px, 3.5vw, 38px);
    font-weight: 640;
    letter-spacing: -0.035em;
  }

  .head p {
    margin: 0;
    color: var(--text-faint);
    font-size: 12.5px;
    line-height: 1.5;
  }

  .actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 18px;
  }

  .primary,
  .secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    height: 34px;
    padding: 0 15px;
    border-radius: 999px;
    font-size: 12.5px;
    font-weight: 600;
  }

  .primary {
    background: var(--accent);
    color: #08080b;
  }

  .primary:hover {
    background: var(--accent-strong);
  }

  .primary:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .secondary {
    border: 1px solid var(--stroke);
    color: var(--text-dim);
    font-weight: 500;
  }

  .secondary:hover {
    border-color: var(--stroke-strong);
    color: var(--text);
    background: var(--glass-hover);
  }

  .empty {
    display: flex;
    align-items: flex-start;
    gap: 18px;
    max-width: 600px;
    padding: 22px;
    border: 1px solid var(--stroke);
    border-radius: var(--radius-lg);
    background: var(--bg-elevated);
  }

  .empty-art {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    flex-shrink: 0;
    border-radius: 14px;
    color: var(--text-faint);
    background: var(--glass-active);
  }

  .empty h2 {
    margin: 0 0 5px;
    font-size: 15px;
  }

  .empty p {
    margin: 0 0 14px;
    color: var(--text-faint);
    font-size: 12.5px;
    line-height: 1.55;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .link {
    color: var(--text-faint);
    font-size: 12px;
  }

  .link:hover {
    color: var(--text);
  }

  .more {
    align-self: flex-start;
    padding: 5px 10px;
    border-radius: 7px;
  }

  .more:hover {
    background: var(--glass-hover);
  }
</style>
