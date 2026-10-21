<script lang="ts">
  import type { CatalogItem, DownloadCollection, DownloadEntry, DownloadJobView } from '@shared/types'
  import { downloads } from '../lib/downloads.svelte'
  import { nav } from '../lib/nav.svelte'
  import { player } from '../lib/player.svelte'
  import {
    collectionBytes,
    collectionEntries,
    collectionItems,
    entryToItem,
    formatSize as size,
    standaloneEntries
  } from '../lib/download-groups'
  import Icon from './Icon.svelte'
  import Cover from './Cover.svelte'
  import TrackRow from './TrackRow.svelte'

  const entries = $derived(downloads.entries)
  const collections = $derived(downloads.collections)
  const stats = $derived(downloads.stats)
  const jobs = $derived(
    Object.values(downloads.jobs).sort((a, b) => a.track.title.localeCompare(b.track.title))
  )

  const groups = $derived.by(() =>
    collections
      .map((collection) => ({
        collection,
        entries: collectionEntries(collection, entries),
        items: collectionItems(collection, entries)
      }))
      .filter((group) => group.collection.trackIds.length > 0)
  )

  const allItems = $derived(entries.map((entry) => entryToItem(entry, collections)))

  /**
   * A song that belongs to a downloaded album/playlist lives on that page. Listing
   * it here too made a downloaded album look like a pile of loose tracks.
   */
  const standalone = $derived(standaloneEntries(collections, entries))
  const standaloneItems = $derived(standalone.map((entry) => entryToItem(entry, collections)))

  function openCollection(collection: DownloadCollection): void {
    nav.openCollection({ kind: 'download', key: collection.key })
  }

  function play(tracks: CatalogItem[]): void {
    if (tracks.length > 0) void player.playList(tracks, 0)
  }

  async function removeCollection(collection: DownloadCollection): Promise<void> {
    const note =
      collection.kind === 'liked'
        ? 'Remove the Liked songs download?'
        : `Remove “${collection.title}” from downloads?`
    if (window.confirm(`${note} Files another download uses stay on disk.`)) {
      await downloads.removeCollection(collection.key)
    }
  }

  async function removeTrack(entry: DownloadEntry): Promise<void> {
    if (window.confirm(`Remove the download for “${entry.track.title}”?`)) {
      await downloads.removeTrack(entry.track.id)
    }
  }

  async function clearAll(): Promise<void> {
    if (entries.length === 0 && jobs.length === 0) return
    if (window.confirm('Remove every download from this device?')) {
      await downloads.clear()
    }
  }

  function jobLabel(job: DownloadJobView): string {
    if (job.state === 'downloading') return `${job.percent ?? 0}%`
    if (job.state === 'queued') return 'Queued'
    if (job.state === 'paused') return 'Paused'
    return 'Failed'
  }

  function jobDetail(job: DownloadJobView): string {
    if (job.error && job.state === 'failed') return job.error
    if (job.state === 'downloading') {
      const total = job.totalBytes ? size(job.totalBytes) : ''
      return total ? `${size(job.downloadedBytes)} of ${total}` : 'Downloading'
    }
    if (job.state === 'paused') return 'Waiting for a connection'
    return job.state === 'queued' ? 'Waiting its turn' : 'Try again'
  }
</script>

<div class="view">
  <header class="head">
    <div class="head-top">
      <div>
        <p class="eyebrow">On this device</p>
        <h1>Downloads</h1>
        <p class="stats">
          {entries.length} {entries.length === 1 ? 'song' : 'songs'} · {size(stats?.bytes)}
          {#if stats}
            · {size(stats.freeBytes)} free
          {/if}
        </p>
      </div>
      {#if entries.length > 0}
        <div class="head-actions">
          <button class="primary" onclick={() => play(allItems)}>
            <Icon name="play" size={13} solid /> Play all
          </button>
          <button class="secondary" onclick={clearAll}>Remove all</button>
        </div>
      {/if}
    </div>
  </header>

  {#if jobs.length > 0}
    <section class="section">
      <h2>Downloading</h2>
      <ul class="jobs">
        {#each jobs as job (job.trackId)}
          <li class="job">
            <Cover
              src={job.track.thumbnail}
              size={38}
              radius={6}
              alt={job.track.title}
            />
            <div class="job-text">
              <span class="job-title truncate">{job.track.title}</span>
              <span class="job-detail truncate" class:error={job.state === 'failed'}>
                {jobLabel(job)}
                {job.state === 'downloading' ? ' · ' : ''}
                {jobDetail(job)}
              </span>
              {#if job.state === 'downloading'}
                <span class="bar">
                  <span style="width: {job.percent ?? 0}%"></span>
                </span>
              {/if}
            </div>
            {#if job.state === 'failed'}
              <button class="icon-btn" title="Retry" onclick={() => void downloads.retry(job.trackId)}>
                <Icon name="repeat" size={14} />
              </button>
            {:else}
              <button
                class="icon-btn"
                title="Cancel download"
                onclick={() => void downloads.cancel(job.trackId)}
              >
                <Icon name="close" size={14} />
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if groups.length > 0}
    <section class="section">
      <h2>Collections</h2>
      <ul class="collections">
        {#each groups as group (group.collection.key)}
          <li class="collection">
            <button
              class="collection-main"
              title="Open downloaded {group.collection.kind === 'liked'
                ? 'collection'
                : group.collection.kind}"
              onclick={() => openCollection(group.collection)}
            >
              <Cover
                src={group.collection.artUrl ?? group.collection.thumbnail ?? group.items[0]?.thumbnail}
                size={52}
                radius={group.collection.kind === 'album' ? 8 : 12}
                alt={group.collection.title}
              />
              <span class="collection-text">
                <span class="collection-title truncate">{group.collection.title}</span>
                <span class="collection-sub truncate">
                  {group.collection.kind === 'liked'
                    ? 'Liked songs'
                    : group.collection.kind === 'playlist'
                      ? 'Playlist'
                      : 'Album'}
                  · {group.entries.length}/{group.collection.trackIds.length}
                  {group.collection.trackIds.length === 1 ? 'song' : 'songs'} ·
                  {size(collectionBytes(group.collection, entries))}
                </span>
              </span>
            </button>
            <button class="icon-btn" title="Play" onclick={() => play(group.items)}>
              <Icon name="play" size={14} solid />
            </button>
            <button
              class="icon-btn"
              title="Remove from downloads"
              onclick={() => void removeCollection(group.collection)}
            >
              <Icon name="close" size={14} />
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if standalone.length > 0}
    <section class="section">
      <h2>Songs</h2>
      <ul class="rows">
        {#each standalone as entry, index (entry.track.id)}
          <TrackRow
            item={entryToItem(entry, collections)}
            {index}
            context={standaloneItems}
            showDownload={false}
            meta={`${size(entry.bytes)} · ${entry.quality === 'data-saver' ? 'Data saver' : 'Best'}`}
            onRemove={() => void removeTrack(entry)}
          />
        {/each}
      </ul>
    </section>
  {:else if entries.length === 0 && jobs.length === 0}
    <section class="empty">
      <div class="empty-art"><Icon name="download" size={26} /></div>
      <div>
        <h2>No downloads yet</h2>
        <p>
          Use the download button on a song, album, playlist or Liked songs. Your cache stays
          invisible; only downloads show up here.
        </p>
      </div>
    </section>
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

  .head-top {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 18px;
  }

  .eyebrow {
    margin: 0 0 8px;
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0 0 4px;
    font-size: 32px;
    font-weight: 640;
    letter-spacing: -0.03em;
  }

  .stats {
    margin: 0;
    color: var(--text-faint);
    font-size: 12.5px;
  }

  .head-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
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

  .section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.012em;
  }

  .jobs,
  .collections,
  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .job {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--glass-hover);
  }

  .job-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
  }

  .job-title {
    font-size: 13px;
  }

  .job-detail {
    color: var(--text-faint);
    font-size: 11.5px;
  }

  .job-detail.error {
    color: var(--danger);
  }

  .bar {
    display: block;
    height: 2px;
    margin-top: 2px;
    border-radius: 999px;
    background: var(--stroke);
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 220ms linear;
  }

  .collection {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px;
    border-radius: 12px;
    transition: background var(--speed) var(--ease);
  }

  .collection:hover {
    background: var(--glass-hover);
  }

  .collection-main {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
    padding: 3px;
    text-align: left;
    border-radius: 10px;
  }

  .collection-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .collection-title {
    font-size: 13.5px;
    font-weight: 500;
  }

  .collection-sub {
    color: var(--text-faint);
    font-size: 11.5px;
  }

  .icon-btn {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    border-radius: 8px;
    color: var(--text-faint);
  }

  .icon-btn:hover {
    color: var(--text);
    background: var(--glass-active);
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
    margin: 0;
    color: var(--text-faint);
    font-size: 12.5px;
    line-height: 1.55;
  }

  @media (max-width: 720px) {
    .head-top {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
