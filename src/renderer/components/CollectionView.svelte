<script lang="ts">
  import type { CatalogItem, Track } from '@shared/types'
  import { api } from '../lib/api'
  import { nav, type CollectionRef } from '../lib/nav.svelte'
  import { playlists } from '../lib/playlists.svelte'
  import { player } from '../lib/player.svelte'
  import { downloads } from '../lib/downloads.svelte'
  import { network } from '../lib/network.svelte'
  import { artwork } from '../lib/artwork.svelte'
  import { markFor } from '../lib/library-items'
  import { trackToItem } from '../lib/track'
  import Cover from './Cover.svelte'
  import DownloadBadge from './DownloadBadge.svelte'
  import TrackRow from './TrackRow.svelte'
  import Icon from './Icon.svelte'

  let { ref }: { ref: CollectionRef } = $props()

  let liked = $state<Track[]>([])
  let renaming = $state(false)
  let nameDraft = $state('')
  let confirming = $state(false)

  const isLiked = $derived(ref.kind === 'liked')
  const playlist = $derived(ref.kind === 'playlist' ? playlists.byId(ref.id) : null)
  const tracks = $derived(isLiked ? liked : (playlist?.tracks ?? []))
  const title = $derived(isLiked ? 'Liked songs' : (playlist?.name ?? 'Playlist'))
  const cover = $derived(tracks.find((track) => track.thumbnail)?.thumbnail)
  const coverSrc = $derived(artwork.src(cover))
  const items = $derived(
    tracks.map((track) => ({
      ...trackToItem(track),
      thumbnail: artwork.src(track.thumbnail ?? cover)
    }))
  )
  const total = $derived(tracks.reduce((acc, track) => acc + (track.durationSec ?? 0), 0))
  const collectionKey = $derived(
    isLiked ? 'liked' : playlist ? `playlist:${playlist.id}` : null
  )
  const dlCounts = $derived(downloads.countsFor(tracks))
  const fullyDownloaded = $derived(dlCounts.total > 0 && dlCounts.done === dlCounts.total)
  const mark = $derived(markFor(dlCounts.done, dlCounts.total))
  const progress = $derived(dlCounts.total > 0 ? (dlCounts.done / dlCounts.total) * 100 : 0)

  const offline = $derived(network.offline)
  const downloadedIds = $derived(new Set(downloads.entries.map((entry) => entry.track.id)))
  const availableCount = $derived(
    tracks.filter((track) => !offline || downloadedIds.has(track.id)).length
  )
  const playableItems = $derived(
    items.filter((item) => !offline || downloadedIds.has(item.id))
  )
  const playIndex = $derived(
    new Map(playableItems.map((item, index) => [item.id, index]))
  )

  $effect(() => {
    if (isLiked) void loadLiked()
    else void playlists.load()
  })

  // Cache every image this page can show, not just the hero. Rows only reveal
  // their art once it is safe to paint offline.
  $effect(() => {
    artwork.warm([cover, ...tracks.map((track) => track.thumbnail)], true)
  })

  async function loadLiked(): Promise<void> {
    liked = await api.favorites.list()
  }

  function playAll(): void {
    if (playableItems.length > 0) void player.playList(playableItems, 0)
  }

  async function downloadCollection(): Promise<void> {
    if (!collectionKey) return
    if (fullyDownloaded) {
      if (window.confirm(`Remove “${title}” from downloads?`)) {
        await downloads.removeCollection(collectionKey)
      }
      return
    }

    for (const track of tracks) {
      if (downloads.stateFor(track.id) === 'failed') await downloads.retry(track.id)
    }
    await downloads.addCollection(
      {
        key: collectionKey,
        kind: isLiked ? 'liked' : 'playlist',
        title,
        thumbnail: cover,
        trackIds: tracks.map((track) => track.id)
      },
      tracks
    )
  }

  async function remove(item: CatalogItem): Promise<void> {
    if (isLiked) {
      const track = liked.find((entry) => entry.id === item.id)
      if (track) {
        await api.favorites.toggle({ ...track })
        await loadLiked()
      }
      return
    }
    if (playlist) await playlists.removeTrack(playlist.id, item.id)
  }

  function startRename(): void {
    if (!playlist) return
    nameDraft = playlist.name
    renaming = true
  }

  async function commitRename(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (!playlist) return
    await playlists.rename(playlist.id, nameDraft)
    renaming = false
  }

  async function deletePlaylist(): Promise<void> {
    if (!playlist) return
    await playlists.remove(playlist.id)
    nav.back()
    nav.clearForward()
  }

  function fmt(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }
</script>

<div class="view">
  <header class="hero">
    <span class="art-wrap">
      {#if isLiked}
        <span class="art liked"><Icon name="heart" size={48} solid /></span>
      {:else}
        <Cover src={coverSrc} size={168} radius={14} alt={title} />
      {/if}
      <span class="hero-badge">
        <DownloadBadge {mark} {progress} size={26} />
      </span>
    </span>

    <div class="hero-text">
      <span class="kind">{isLiked ? 'Collection' : 'Playlist'}</span>

      {#if renaming}
        <form class="rename" onsubmit={commitRename}>
          <input bind:value={nameDraft} aria-label="Playlist name" />
          <button type="submit" class="primary">Save</button>
          <button type="button" class="ghost" onclick={() => (renaming = false)}>Cancel</button>
        </form>
      {:else}
        <h1>{title}</h1>
      {/if}

      <p class="meta">
        {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}{total ? ` · ${fmt(total)}` : ''}
        {#if offline && tracks.length > 0}
          <span class="offline" class:partial={availableCount < tracks.length}>
            <Icon name="download" size={11} />
            {availableCount === tracks.length
              ? 'Available offline'
              : `${availableCount} of ${tracks.length} available offline`}
          </span>
        {/if}
      </p>

      <div class="actions">
        <button class="play-all" onclick={playAll} disabled={playableItems.length === 0}>
          <Icon name="play" size={14} solid />
          <span>Play all</span>
        </button>

        {#if collectionKey && tracks.length > 0}
          <button
            class="ghost"
            class:on={fullyDownloaded}
            title={offline && !fullyDownloaded
              ? 'Connect to download'
              : fullyDownloaded
                ? 'Downloaded — click to remove'
                : 'Download this collection'}
            disabled={offline && !fullyDownloaded}
            onclick={() => void downloadCollection()}
          >
            {#if dlCounts.active > 0}
              <span class="spin" aria-hidden="true"></span>
              <span>{dlCounts.done}/{dlCounts.total} downloading</span>
            {:else if fullyDownloaded}
              <Icon name="check" size={14} />
              <span>Downloaded</span>
            {:else}
              <Icon name="download" size={14} />
              <span>Download{dlCounts.done > 0 ? ` (${dlCounts.done}/${dlCounts.total})` : ''}</span>
            {/if}
          </button>
        {/if}

        {#if playlist}
          <button class="ghost" onclick={startRename}>Rename</button>
          {#if confirming}
            <button class="ghost danger" onclick={deletePlaylist}>Delete playlist</button>
            <button class="ghost" onclick={() => (confirming = false)}>Cancel</button>
            {#if dlCounts.done > 0}
              <span class="delete-note">
                {dlCounts.done} downloaded {dlCounts.done === 1 ? 'song' : 'songs'} will be
                removed unless another download uses them.
              </span>
            {/if}
          {:else}
            <button class="ghost" onclick={() => (confirming = true)}>Delete</button>
          {/if}
        {/if}
      </div>
    </div>
  </header>

  {#if tracks.length === 0}
    <p class="placeholder">
      {isLiked
        ? 'Songs you favourite appear here.'
        : 'Use the playlist button on any track row to add songs.'}
    </p>
  {:else}
    <ol class="tracks">
      {#each items as item, i (item.id)}
        <TrackRow
          {item}
          context={playableItems}
          contextIndex={playIndex.get(item.id) ?? i}
          index={i}
          showIndex
          unavailable={offline && !downloadedIds.has(item.id)}
          onQueue={(entry) => player.enqueue(entry)}
          onRemove={remove}
        />
      {/each}
    </ol>
  {/if}
</div>

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
    width: 168px;
    height: 168px;
    flex-shrink: 0;
    display: block;
  }

  .art {
    width: 168px;
    height: 168px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .hero-badge {
    position: absolute;
    right: 8px;
    bottom: 8px;
    display: flex;
  }

  .liked {
    color: var(--text);
    background: linear-gradient(145deg, #26262e, #141419);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
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
  }

  .meta {
    margin: 0;
    color: var(--text-faint);
    font-size: 12px;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .offline {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.05);
    box-shadow: inset 0 0 0 1px var(--stroke);
    color: var(--text-dim);
    font-size: 10.5px;
  }

  .offline.partial {
    color: var(--text-faint);
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

  .ghost:disabled {
    opacity: 0.45;
    cursor: default;
    background: transparent;
    color: var(--text-faint);
  }

  .ghost.on {
    color: var(--text);
    border-color: var(--stroke-strong);
  }

  .spin {
    width: 11px;
    height: 11px;
    border: 1.5px solid var(--stroke-strong);
    border-top-color: var(--text);
    border-radius: 50%;
    animation: spin 700ms linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .delete-note {
    flex-basis: 100%;
    color: var(--text-faint);
    font-size: 11.5px;
    line-height: 1.45;
  }

  .danger {
    color: var(--danger);
    border-color: rgba(255, 128, 128, 0.3);
  }

  .rename {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0 10px;
    flex-wrap: wrap;
  }

  .rename input {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--stroke);
    border-radius: 10px;
    padding: 8px 12px;
    color: var(--text);
    outline: none;
    font-size: 15px;
    min-width: 240px;
  }

  .rename input:focus {
    border-color: var(--stroke-strong);
  }

  .primary {
    background: var(--text);
    color: #08080b;
    border-radius: 999px;
    padding: 8px 16px;
    font-size: 12.5px;
    font-weight: 550;
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
</style>
