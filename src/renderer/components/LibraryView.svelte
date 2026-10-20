<script lang="ts">
  import type { Playlist, Track } from '@shared/types'
  import { api } from '../lib/api'
  import { playlists } from '../lib/playlists.svelte'
  import { nav } from '../lib/nav.svelte'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'

  let favorites = $state<Track[]>([])
  let creating = $state(false)
  let name = $state('')

  $effect(() => {
    void playlists.load(true)
    void loadFavorites()
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

  function coverOf(playlist: Playlist): string | undefined {
    return playlist.tracks[0]?.thumbnail
  }

  function count(n: number): string {
    return `${n} ${n === 1 ? 'song' : 'songs'}`
  }
</script>

<div class="view">
  <header class="head">
    <h1>Library</h1>
    <p>Saved on this machine. No account, nothing to sync.</p>
  </header>

  <div class="grid">
    <button class="tile" onclick={() => nav.openCollection({ kind: 'liked' })}>
      <span class="art liked">
        <Icon name="heart" size={44} solid />
      </span>
      <span class="tile-title truncate">Liked songs</span>
      <span class="tile-sub">{count(favorites.length)}</span>
    </button>

    {#each playlists.items as playlist (playlist.id)}
      <button class="tile" onclick={() => nav.openCollection({ kind: 'playlist', id: playlist.id })}>
        <Cover src={coverOf(playlist)} size={152} radius={12} alt={playlist.name} />
        <span class="tile-title truncate">{playlist.name}</span>
        <span class="tile-sub">{count(playlist.tracks.length)}</span>
      </button>
    {/each}

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
  </div>
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 4px 2px 20px;
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

  .tile:hover .art {
    transform: translateY(-3px);
    box-shadow: var(--shadow-card);
  }

  .art {
    position: relative;
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

  .tile-title {
    font-size: 13px;
    font-weight: 500;
    margin-top: 4px;
  }

  .tile-sub {
    font-size: 11.5px;
    color: var(--text-faint);
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
</style>
