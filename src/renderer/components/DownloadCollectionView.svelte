<script lang="ts">
  import type { DownloadEntry } from '@shared/types'
  import { downloads } from '../lib/downloads.svelte'
  import { nav } from '../lib/nav.svelte'
  import { player } from '../lib/player.svelte'
  import {
    collectionEntries,
    collectionItems,
    formatDuration,
    formatSize
  } from '../lib/download-groups'
  import { markFor } from '../lib/library-items'
  import Cover from './Cover.svelte'
  import DownloadBadge from './DownloadBadge.svelte'
  import TrackRow from './TrackRow.svelte'
  import Icon from './Icon.svelte'

  let { collectionKey }: { collectionKey: string } = $props()

  const collection = $derived(
    downloads.collections.find((item) => item.key === collectionKey) ?? null
  )
  const entries = $derived(
    collection ? collectionEntries(collection, downloads.entries) : []
  )
  const items = $derived(
    collection ? collectionItems(collection, downloads.entries) : []
  )
  const total = $derived(entries.reduce((sum, entry) => sum + (entry.track.durationSec ?? 0), 0))
  const bytes = $derived(entries.reduce((sum, entry) => sum + entry.bytes, 0))
  const art = $derived(collection?.artUrl ?? collection?.thumbnail ?? items[0]?.thumbnail)
  const mark = $derived(markFor(entries.length, collection?.trackIds.length ?? 0))
  const progress = $derived(
    collection && collection.trackIds.length > 0
      ? (entries.length / collection.trackIds.length) * 100
      : 0
  )

  const kindLabel = $derived(
    collection?.kind === 'album'
      ? 'Downloaded album'
      : collection?.kind === 'playlist'
        ? 'Downloaded playlist'
        : 'Downloaded liked songs'
  )

  const artistLine = $derived.by(() => {
    if (collection?.kind !== 'album') return ''
    const names = [...new Set(entries.map((entry) => entry.track.artist).filter(Boolean))]
    return names.slice(0, 3).join(', ')
  })

  const quality = $derived.by(() => {
    const kinds = new Set(entries.map((entry) => entry.quality))
    if (kinds.size !== 1) return null
    return entries[0]?.quality === 'data-saver' ? 'Data saver' : 'Best quality'
  })

  function playAll(): void {
    if (items.length > 0) void player.playList(items, 0)
  }

  async function removeCollection(): Promise<void> {
    if (!collection) return
    const note =
      collection.kind === 'liked'
        ? 'Remove the Liked songs download?'
        : `Remove “${collection.title}” from downloads?`
    if (!window.confirm(`${note} Files another download uses stay on disk.`)) return
    await downloads.removeCollection(collection.key)
    nav.back()
    nav.clearForward()
  }

  async function removeEntry(entry: DownloadEntry): Promise<void> {
    if (!collection) return
    const shared = entry.sources.some((source) => source !== collection.key)
    const note = shared
      ? 'The file stays on disk for the other download that uses it.'
      : 'The file will be deleted from this device.'
    if (!window.confirm(`Remove “${entry.track.title}” from this download? ${note}`)) return

    const remaining = collection.trackIds.filter((id) => id !== entry.track.id)
    if (remaining.length === 0) {
      await downloads.removeCollection(collection.key)
      nav.back()
      nav.clearForward()
      return
    }
    await downloads.pruneCollection(collection.key, remaining)
  }
</script>

{#if !collection}
  <div class="view missing">
    <span class="kind">Library</span>
    <h1>This download is gone</h1>
    <p class="missing-text">It is no longer on this device.</p>
    <button class="play-all" onclick={() => nav.go('library')}>Back to Library</button>
  </div>
{:else}
  <div class="view">
    <header class="hero">
      <div class="art-wrap">
        <Cover src={art} size={168} radius={14} alt={collection.title} />
        <span class="offline-badge">
          <DownloadBadge {mark} {progress} size={26} />
        </span>
      </div>

      <div class="hero-text">
        <span class="kind">{kindLabel}</span>
        <h1>{collection.title}</h1>
        {#if artistLine}
          <p class="artist">{artistLine}</p>
        {/if}

        <p class="meta">
          <span class="offline">
            <Icon name="download" size={11} />
            <span>Offline ready</span>
          </span>
          <span>
            {entries.length}{#if entries.length !== collection.trackIds.length}
              of {collection.trackIds.length}{/if}
            {entries.length === 1 ? 'song' : 'songs'}
            {#if total}· {formatDuration(total)}{/if}
            · {formatSize(bytes)} on this device
            {#if quality}· {quality}{/if}
          </span>
        </p>

        <div class="actions">
          <button class="play-all" onclick={playAll} disabled={items.length === 0}>
            <Icon name="play" size={14} solid />
            <span>Play all</span>
          </button>
          <button class="ghost" onclick={() => void removeCollection()}>
            <Icon name="close" size={13} />
            <span>Remove download</span>
          </button>
        </div>
      </div>
    </header>

    {#if entries.length === 0}
      <p class="placeholder">Every song has been removed from this download.</p>
    {:else}
      <ol class="tracks">
        {#each entries as entry, i (entry.track.id)}
          <TrackRow
            item={items[i]}
            context={items}
            index={i}
            showIndex
            showArt
            showDownload={false}
            meta={`${formatSize(entry.bytes)} · ${entry.quality === 'data-saver' ? 'Data saver' : 'Best'}`}
            onQueue={(item) => player.enqueue(item)}
            onRemove={() => void removeEntry(entry)}
          />
        {/each}
      </ol>
    {/if}
  </div>
{/if}

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 4px 2px 20px;
  }

  .hero {
    display: flex;
    gap: 22px;
    align-items: flex-end;
  }

  .art-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .offline-badge {
    position: absolute;
    right: 9px;
    bottom: 9px;
    display: flex;
  }

  .hero-text {
    min-width: 0;
    padding-bottom: 2px;
  }

  .kind {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-faint);
  }

  h1 {
    font-size: 36px;
    font-weight: 650;
    margin: 5px 0 7px;
    letter-spacing: -0.035em;
    line-height: 1.08;
  }

  .artist {
    margin: 0 0 6px;
    color: var(--text-dim);
    font-size: 13px;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 9px;
    flex-wrap: wrap;
    margin: 0;
    color: var(--text-faint);
    font-size: 12px;
  }

  .offline {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 999px;
    color: var(--text-dim);
    border: 1px solid var(--stroke);
    font-size: 10.5px;
    font-weight: 550;
    letter-spacing: 0.02em;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
    flex-wrap: wrap;
  }

  .play-all {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 20px 9px 17px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 550;
    color: #08080b;
    background: var(--text);
    transition: transform var(--speed) var(--ease);
  }

  .play-all:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .play-all:disabled {
    background: var(--glass-active);
    color: var(--text-faint);
  }

  .ghost {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: 1px solid var(--stroke);
    border-radius: 999px;
    padding: 8px 14px;
    font-size: 12.5px;
    color: var(--text-dim);
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .ghost:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .tracks {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .placeholder {
    color: var(--text-faint);
    font-size: 13px;
  }

  .missing {
    gap: 10px;
    padding-top: 18px;
  }

  .missing h1 {
    margin: 0;
  }

  .missing-text {
    margin: 0 0 8px;
    color: var(--text-faint);
    font-size: 13px;
  }
</style>
