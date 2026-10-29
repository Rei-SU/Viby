<script lang="ts">
  import type { Track } from '@shared/types'
  import { downloads } from '../lib/downloads.svelte'
  import Icon from './Icon.svelte'

  let {
    collectionKey,
    kind,
    title,
    cover,
    tracks,
    offline = false,
    variant = 'hero'
  }: {
    collectionKey: string | null
    kind: 'album' | 'playlist' | 'liked'
    title: string
    cover?: string
    tracks: Track[]
    /** Pages that cannot start a download while offline pass their state. */
    offline?: boolean
    /** `hero` sits in an album header; `actions` joins a flex action row. */
    variant?: 'hero' | 'actions'
  } = $props()

  const counts = $derived(downloads.countsFor(tracks, collectionKey ?? undefined))
  const fullyDownloaded = $derived(counts.total > 0 && counts.done === counts.total)
  const pending = $derived(counts.active > 0 || counts.paused > 0)
  const disabled = $derived(offline && !fullyDownloaded && counts.active === 0)

  const label = $derived(
    counts.active > 0
      ? `Pause remaining downloads (${counts.done}/${counts.total} downloaded)`
      : counts.paused > 0 && !offline
        ? `Resume paused downloads (${counts.done}/${counts.total} downloaded)`
        : offline && !fullyDownloaded
          ? 'Connect to download'
          : fullyDownloaded
            ? 'Downloaded — click to remove'
            : 'Download this collection'
  )

  async function toggle(): Promise<void> {
    if (!collectionKey) return
    if (fullyDownloaded) {
      if (window.confirm(`Remove “${title}” from downloads?`)) {
        await downloads.removeCollection(collectionKey)
      }
      return
    }
    if (counts.active > 0) {
      await downloads.pauseCollection(collectionKey)
      return
    }
    if (counts.paused > 0) {
      await downloads.resumeCollection(collectionKey)
      return
    }

    for (const track of tracks) {
      if (downloads.stateFor(track.id) === 'failed') await downloads.retry(track.id)
    }
    await downloads.addCollection(
      {
        key: collectionKey,
        kind,
        title,
        thumbnail: cover,
        trackIds: tracks.map((track) => track.id)
      },
      tracks
    )
  }

  async function cancel(): Promise<void> {
    if (collectionKey) await downloads.cancelCollection(collectionKey)
  }
</script>

<button
  class="download-all {variant}"
  class:on={fullyDownloaded || pending}
  title={label}
  {disabled}
  onclick={() => void toggle()}
>
  {#if counts.active > 0}
    <Icon name="pause" size={13} solid />
    <span>Pause download</span>
  {:else if counts.paused > 0 && !offline}
    <Icon name="play" size={13} solid />
    <span>Resume download</span>
  {:else if fullyDownloaded}
    <Icon name="check" size={14} />
    <span>Downloaded</span>
  {:else}
    <Icon name="download" size={14} />
    <span>Download{counts.done > 0 ? ` (${counts.done}/${counts.total})` : ''}</span>
  {/if}
</button>

{#if pending}
  <button
    class="cancel-download {variant}"
    title="Cancel remaining downloads"
    aria-label="Cancel remaining downloads"
    onclick={() => void cancel()}
  >
    <Icon name="close" size={13} />
  </button>
{/if}

<style>
  .download-all {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--stroke);
    border-radius: 999px;
    color: var(--text-dim);
    font-size: 12.5px;
    font-weight: 500;
    transition:
      border-color var(--speed) var(--ease),
      color var(--speed) var(--ease),
      background var(--speed) var(--ease);
  }

  .download-all.hero {
    margin: 14px 0 0 8px;
    padding: 8px 16px;
  }

  .download-all.actions {
    padding: 8px 14px;
  }

  .download-all:hover {
    border-color: var(--stroke-strong);
    color: var(--text);
    background: var(--glass-hover);
  }

  .download-all.on {
    color: var(--text);
    border-color: var(--stroke-strong);
  }

  .download-all:disabled {
    opacity: 0.45;
    cursor: default;
    background: transparent;
    color: var(--text-faint);
  }

  .cancel-download {
    display: inline-grid;
    place-items: center;
    width: 33px;
    height: 33px;
    border: 1px solid var(--stroke);
    border-radius: 999px;
    color: var(--text-dim);
    vertical-align: top;
    transition:
      border-color var(--speed) var(--ease),
      color var(--speed) var(--ease),
      background var(--speed) var(--ease);
  }

  .cancel-download.hero {
    margin: 14px 0 0 8px;
  }

  .cancel-download:hover {
    border-color: var(--stroke-strong);
    color: var(--text);
    background: var(--glass-hover);
  }
</style>
