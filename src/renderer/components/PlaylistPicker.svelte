<script lang="ts">
  import { playlistPicker as picker } from '../lib/playlist-picker.svelte'
  import { playlists } from '../lib/playlists.svelte'
  import Icon from './Icon.svelte'

  let creating = $state(false)
  let name = $state('')
  let added = $state<string | null>(null)
  let closeTimer: ReturnType<typeof setTimeout> | null = null

  $effect(() => {
    if (!picker.open) return
    void playlists.load()
    creating = false
    name = ''
    added = null
  })

  async function add(id: string, label: string): Promise<void> {
    if (!picker.track) return
    await playlists.addTrack(id, { ...picker.track })
    added = label
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = setTimeout(() => picker.close(), 600)
  }

  async function createAndAdd(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (!picker.track || !name.trim()) return
    const playlist = await playlists.create(name)
    await playlists.addTrack(playlist.id, { ...picker.track })
    picker.close()
  }
</script>

{#if picker.open && picker.track}
  <div class="scrim" role="presentation" onclick={() => picker.close()}></div>

  <div
    class="panel"
    style="left: {picker.x}px; top: {picker.y}px"
    role="dialog"
    aria-label="Add to playlist"
  >
    <header>
      <span class="eyebrow">Add to playlist</span>
      <button class="close" onclick={() => picker.close()} aria-label="Close">
        <Icon name="close" size={14} />
      </button>
    </header>

    {#if added}
      <p class="done">Added to {added}</p>
    {:else}
      {#if playlists.items.length > 0}
        <ul class="list">
          {#each playlists.items as playlist (playlist.id)}
            <li>
              <button onclick={() => add(playlist.id, playlist.name)}>
                <span class="name truncate">{playlist.name}</span>
                <span class="n">{playlist.tracks.length}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else if !creating}
        <p class="empty">No playlists yet.</p>
      {/if}

      {#if creating}
        <form class="create" onsubmit={createAndAdd}>
          <input bind:value={name} placeholder="New playlist" aria-label="New playlist name" />
          <button type="submit" disabled={!name.trim()}>Create</button>
        </form>
      {:else}
        <button class="new" onclick={() => (creating = true)}>
          <Icon name="plus" size={14} />
          <span>New playlist</span>
        </button>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 90;
  }

  .panel {
    position: fixed;
    z-index: 91;
    width: 248px;
    max-height: 320px;
    border-radius: 12px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: rgba(18, 18, 24, 0.94);
    border: 1px solid var(--stroke-strong);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(26px) saturate(150%);
    -webkit-backdrop-filter: blur(26px) saturate(150%);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-left: 2px;
  }

  .eyebrow {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--text-faint);
  }

  .close {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    color: var(--text-faint);
  }

  .close:hover {
    color: var(--text);
    background: var(--glass-hover);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    max-height: 190px;
  }

  .list button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 7px 8px;
    border-radius: 8px;
    font-size: 12.5px;
    color: var(--text-dim);
    text-align: left;
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .list button:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .name {
    min-width: 0;
  }

  .n {
    color: var(--text-faint);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .empty {
    margin: 0;
    padding: 2px 8px 6px;
    color: var(--text-faint);
    font-size: 12px;
  }

  .new {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px;
    border-radius: 8px;
    color: var(--text-dim);
    font-size: 12.5px;
    text-align: left;
  }

  .new:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .create {
    display: flex;
    gap: 6px;
  }

  .create input {
    flex: 1;
    min-width: 0;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--stroke);
    border-radius: 8px;
    padding: 6px 9px;
    color: var(--text);
    outline: none;
    font-size: 12.5px;
  }

  .create input:focus {
    border-color: var(--stroke-strong);
  }

  .create button {
    background: var(--text);
    color: #08080b;
    border-radius: 8px;
    padding: 0 11px;
    font-size: 12px;
    font-weight: 550;
  }

  .create button:disabled {
    background: var(--glass-active);
    color: var(--text-faint);
  }

  .done {
    margin: 2px 8px 6px;
    color: var(--text);
    font-size: 12.5px;
  }
</style>
