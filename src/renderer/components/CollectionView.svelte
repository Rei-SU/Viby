<script lang="ts">
  import type { CatalogItem, Track } from '@shared/types'
  import { api } from '../lib/api'
  import { nav, type CollectionRef } from '../lib/nav.svelte'
  import { playlists } from '../lib/playlists.svelte'
  import { player } from '../lib/player.svelte'
  import { trackToItem } from '../lib/track'
  import Cover from './Cover.svelte'
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
  const items = $derived(tracks.map(trackToItem))
  const title = $derived(isLiked ? 'Liked songs' : (playlist?.name ?? 'Playlist'))
  const cover = $derived(tracks[0]?.thumbnail)
  const total = $derived(tracks.reduce((acc, track) => acc + (track.durationSec ?? 0), 0))

  $effect(() => {
    if (isLiked) void loadLiked()
    else void playlists.load()
  })

  async function loadLiked(): Promise<void> {
    liked = await api.favorites.list()
  }

  function playAll(): void {
    if (items.length > 0) void player.playList(items, 0)
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
  }

  function fmt(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }
</script>

<div class="view">
  <button class="back" onclick={() => nav.back()}>
    <Icon name="back" size={16} />
    <span>Back</span>
  </button>

  <header class="hero">
    {#if isLiked}
      <span class="art liked"><Icon name="heart" size={48} solid /></span>
    {:else}
      <Cover src={cover} size={168} radius={14} alt={title} />
    {/if}

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
      </p>

      <div class="actions">
        <button class="play-all" onclick={playAll} disabled={items.length === 0}>
          <Icon name="play" size={14} solid />
          <span>Play all</span>
        </button>

        {#if playlist}
          <button class="ghost" onclick={startRename}>Rename</button>
          {#if confirming}
            <button class="ghost danger" onclick={deletePlaylist}>Delete playlist</button>
            <button class="ghost" onclick={() => (confirming = false)}>Cancel</button>
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
          context={items}
          index={i}
          showIndex
          showArt={false}
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

  .back {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-dim);
    font-size: 12.5px;
    padding: 5px 10px 5px 6px;
    border-radius: 999px;
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .back:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .hero {
    display: flex;
    gap: 22px;
    align-items: flex-end;
  }

  .art {
    width: 168px;
    height: 168px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
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
