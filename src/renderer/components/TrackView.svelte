<script lang="ts">
  import type { CatalogItem, Track } from '@shared/types'
  import { api } from '../lib/api'
  import { player } from '../lib/player.svelte'
  import { network } from '../lib/network.svelte'
  import { cacheRadio, cachedRadio } from '../lib/catalog-cache.svelte'
  import { openAlbum } from '../lib/album'
  import ArtistLinks from './ArtistLinks.svelte'
  import { trackToItem } from '../lib/track'
  import Cover from './Cover.svelte'
  import TrackRow from './TrackRow.svelte'
  import Icon from './Icon.svelte'

  let { track }: { track: Track } = $props()

  let related = $state<CatalogItem[]>([])

  const isCurrent = $derived(
    player.current?.id === track.id ||
      (player.current?.sourceId != null && player.current.sourceId === track.id)
  )
  const isPlaying = $derived(isCurrent && player.playing)

  $effect(() => {
    const id = track.id
    // Never leave the previous song's related list visible under a new title.
    related = []
    const cached = cachedRadio(id)
    if (cached) {
      related = cached.slice(0, 10)
      return
    }

    if (network.localFirst) return

    let alive = true
    void api.catalog.radio(id).then((res) => {
      if (!alive || !res.ok) return
      cacheRadio(id, res.data)
      related = res.data.slice(0, 10)
    })

    return () => {
      alive = false
    }
  })

  function asItem(): CatalogItem {
    return trackToItem(track)
  }

  function togglePlay(): void {
    if (isCurrent) player.toggle()
    else void player.playList([asItem()], 0)
  }

  function openAlbumPage(): void {
    if (track.album) openAlbum(track.albumId, track.album, track.thumbnail)
  }

  function fmt(seconds: number): string {
    if (!seconds) return ''
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }
</script>

<div class="view">
  <header class="hero">
    {#if track.thumbnail}
      <span class="glow" style="background-image: url({track.thumbnail})"></span>
    {/if}
    <Cover src={track.thumbnail} size={184} radius={14} alt={track.title} />
    <div class="hero-text">
      <span class="kind">Song</span>
      <h1>{track.title}</h1>

      <div class="byline">
        <span class="byline-artists">
          <ArtistLinks parts={track.artistParts} name={track.artist} id={track.artistId} />
        </span>
        {#if track.album}
          <span class="sep">·</span>
          <button class="link dim" onclick={openAlbumPage}>{track.album}</button>
        {/if}
        {#if track.durationSec}
          <span class="sep">·</span>
          <span class="dim">{fmt(track.durationSec)}</span>
        {/if}
      </div>

      <div class="actions">
        <button class="play" onclick={togglePlay}>
          <Icon name={isPlaying ? 'pause' : 'play'} size={14} solid />
          <span>{isPlaying ? 'Pause' : 'Play'}</span>
        </button>
        <button class="ghost" onclick={() => player.enqueue(asItem())}>Add to queue</button>
      </div>
    </div>
  </header>

  <section class="related">
    <h2>Related songs</h2>
    {#if related.length === 0}
      <p class="placeholder">Finding similar tracks…</p>
    {:else}
      <ul class="tracks">
        {#each related as item, i (item.id)}
          <TrackRow {item} context={related} index={i} onQueue={(x) => player.enqueue(x)} />
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 22px;
    padding: 2px 2px 20px;
  }

  .hero {
    position: relative;
    isolation: isolate;
    display: flex;
    gap: 24px;
    align-items: flex-end;
    padding: 10px 4px 6px;
  }

  .glow {
    position: absolute;
    inset: -50px -10px -20px;
    z-index: -1;
    background-size: cover;
    background-position: center;
    filter: blur(70px) grayscale(1);
    opacity: 0.2;
    border-radius: 50%;
    pointer-events: none;
  }

  .hero-text {
    min-width: 0;
    padding-bottom: 4px;
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

  .byline {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 13px;
    color: var(--text-dim);
  }

  .link {
    color: var(--text);
    padding: 0;
    font: inherit;
  }

  .byline-artists {
    color: var(--text);
  }

  .link:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .dim {
    color: var(--text-dim);
  }

  .sep {
    color: var(--text-faint);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
  }

  .play {
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

  .play:hover {
    transform: translateY(-1px);
  }

  .ghost {
    border: 1px solid var(--stroke);
    border-radius: 999px;
    padding: 9px 16px;
    font-size: 13px;
    color: var(--text-dim);
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .ghost:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .related {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  h2 {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    letter-spacing: -0.012em;
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
