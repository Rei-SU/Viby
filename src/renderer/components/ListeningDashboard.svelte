<script lang="ts">
  import type { ListeningArtist, ListeningSummary } from '@shared/listening'
  import type { CatalogItem } from '@shared/types'
  import { api } from '../lib/api'
  import { player } from '../lib/player.svelte'
  import { nav } from '../lib/nav.svelte'
  import { searchState } from '../lib/search.svelte'
  import { sidePanel } from '../lib/side-panel.svelte'
  import { artwork } from '../lib/artwork.svelte'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'
  import TrackRow from './TrackRow.svelte'

  let { items, summary }: { items: CatalogItem[]; summary: ListeningSummary } = $props()

  const latest = $derived(items[0])
  const totalLabel = $derived(
    summary.totalSeconds > 0 ? listeningTime(summary.totalSeconds) : `${summary.uniqueTracks} songs`
  )
  const totalDetail = $derived(
    summary.totalSeconds > 0 ? `${summary.uniqueTracks} songs` : 'this week'
  )
  const artists = $derived(summary.artists.filter((artist) => artist.name !== 'Unknown artist'))

  let artistImages = $state<Record<string, string | null>>({})
  const pendingImages = new Set<string>()

  $effect(() => {
    for (const artist of artists.slice(0, 3)) {
      if (artist.key in artistImages || pendingImages.has(artist.key)) continue
      pendingImages.add(artist.key)
      void api.catalog
        .artistImage(artist.artistId, artist.name)
        .then((result) => {
          pendingImages.delete(artist.key)
          artistImages = {
            ...artistImages,
            [artist.key]: result.ok ? result.data : null
          }
        })
        .catch(() => {
          pendingImages.delete(artist.key)
          artistImages = { ...artistImages, [artist.key]: null }
        })
    }
  })

  function listeningTime(seconds: number): string {
    const minutes = Math.max(0, Math.round(seconds / 60))
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const remainder = minutes % 60
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`
  }

  function showHistory(): void {
    sidePanel.toggle('history')
  }

  function monogram(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase()
  }

  function openArtist(artist: ListeningArtist): void {
    if (artist.artistId) {
      nav.openArtist(artist.artistId, artist.name, artistImages[artist.key] ?? undefined)
      return
    }
    searchState.setQuery(artist.name)
    searchState.submit('artists')
    nav.go('search')
  }

  function share(artist: ListeningArtist): number {
    if (summary.totalSeconds > 0) return Math.min(1, artist.seconds / summary.totalSeconds)
    return summary.plays > 0 ? Math.min(1, artist.plays / summary.plays) : 0
  }

  const pulsePeak = $derived(
    Math.max(1, ...summary.days.map((day) => (summary.totalSeconds > 0 ? day.seconds : day.plays)))
  )

  function pulseHeight(day: { seconds: number; plays: number }): number {
    const value = summary.totalSeconds > 0 ? day.seconds : day.plays
    return Math.max(0.08, value / pulsePeak)
  }
</script>

<section class="dashboard" aria-label="Your listening snapshot">
  <div class="recent-card">
    <header class="card-head">
      <div>
        <span class="eyebrow">Your listening</span>
        <h2>Recently played</h2>
      </div>
      <div class="head-actions">
        {#if latest}
          <button class="more" onclick={showHistory}>Show more</button>
          <button class="resume" onclick={() => player.playList([latest], 0)}>
            <Icon name="play" size={11} solid /> Resume
          </button>
        {/if}
      </div>
    </header>

    {#if items.length === 0}
      <p class="empty">Nothing played yet. Start something and it lands here.</p>
    {:else}
      <ul class="recent-list">
        <!-- Index keys: the same song can appear twice; history order is the identity. -->
        {#each items.slice(0, 5) as item, i (i)}
          <TrackRow {item} showFavorite />
        {/each}
      </ul>
    {/if}
  </div>

  <aside class="week-card">
    <span class="eyebrow">Past 7 days</span>
    <h2>Listening snapshot</h2>
    <div class="week-total">
      <strong>{totalLabel}</strong>
      <span>{totalDetail}</span>
    </div>

    <div class="week-pulse" aria-hidden="true">
      {#each summary.days as day, i}
        <span class:pulse-current={i === 6}>
          <span style="--height: {pulseHeight(day)}; --delay: {i * 45}ms"></span>
        </span>
      {/each}
    </div>

    {#if artists.length > 0}
      <span class="section-label">Top artists</span>
      <div class="artist-list">
        {#each artists.slice(0, 3) as artist, i (artist.key)}
          <button class="artist" onclick={() => openArtist(artist)}>
            <span class="artist-main">
              <span class="rank">0{i + 1}</span>
              {#if artistImages[artist.key]}
                <Cover src={artwork.src(artistImages[artist.key] ?? undefined)} size={30} radius={15} alt="" />
              {:else}
                <span class="artist-monogram" aria-hidden="true">{monogram(artist.name)}</span>
              {/if}
              <span class="artist-copy">
                <strong>{artist.name}</strong>
                <span>{artist.tracks} {artist.tracks === 1 ? 'song' : 'songs'}</span>
              </span>
              {#if artist.seconds > 0}<span class="artist-time">{listeningTime(artist.seconds)}</span>{/if}
            </span>
            <span class="share" aria-hidden="true">
              <span style="--share: {share(artist)}; --delay: {i * 60}ms"></span>
            </span>
          </button>
        {/each}
      </div>
    {:else}
      <p class="empty">
        {summary.plays > 0
          ? 'Artist names will appear as Viby learns more from the catalogue.'
          : 'Play something to start your weekly snapshot.'}
      </p>
    {/if}
  </aside>
</section>

<style>
  .dashboard {
    display: grid;
    grid-template-columns: minmax(0, 1.65fr) minmax(250px, 0.85fr);
    gap: 16px;
    align-items: stretch;
    animation: dashboard-in 320ms var(--ease);
  }

  .recent-card,
  .week-card {
    min-width: 0;
    border: 1px solid var(--stroke);
    border-radius: var(--radius-lg);
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.028), rgba(255, 255, 255, 0.008));
  }

  .recent-card {
    padding: 18px 18px 14px;
  }

  .week-card {
    display: flex;
    flex-direction: column;
    padding: 18px;
  }

  .card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }

  .eyebrow {
    display: block;
    color: var(--text-faint);
    font-size: 9.5px;
    font-weight: 550;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h2 {
    margin: 3px 0 0;
    color: var(--text);
    font-size: 18px;
    font-weight: 620;
    letter-spacing: -0.025em;
  }

  .resume {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    padding: 6px 11px;
    border-radius: 999px;
    background: var(--accent);
    color: #08080b;
    font-size: 10.5px;
    font-weight: 600;
    transition: transform var(--speed) var(--ease);
  }

  .resume:hover {
    transform: translateY(-1px);
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .more {
    padding: 5px 10px;
    border-radius: 999px;
    color: var(--text-dim);
    font-size: 10.5px;
    font-weight: 550;
    border: 1px solid var(--stroke);
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .more:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .recent-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .week-total {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 12px 0 16px;
  }

  .week-total strong {
    color: var(--text);
    font-size: 30px;
    font-weight: 650;
    letter-spacing: -0.045em;
    font-variant-numeric: tabular-nums;
  }

  .week-total span {
    color: var(--text-faint);
    font-size: 10.5px;
  }

  .week-pulse {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    align-items: end;
    gap: 5px;
    height: 24px;
    margin: -3px 0 16px;
  }

  .week-pulse > span {
    display: flex;
    align-items: flex-end;
    height: 100%;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.035);
  }

  .week-pulse > span > span {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    background: rgba(255, 255, 255, 0.18);
    transform: scaleY(var(--height));
    transform-origin: bottom;
    animation: pulse-in 500ms var(--ease) var(--delay) both;
  }

  .week-pulse > .pulse-current > span {
    background: rgba(255, 255, 255, 0.78);
  }

  .section-label {
    margin-bottom: 5px;
    color: var(--text-faint);
    font-size: 10px;
  }

  .artist-list {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
  }

  .artist {
    width: 100%;
    padding: 6px 0;
    text-align: left;
  }

  .artist-main {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .rank {
    width: 16px;
    flex-shrink: 0;
    color: var(--text-faint);
    font-size: 9px;
    font-variant-numeric: tabular-nums;
  }

  .artist-monogram {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    border: 1px solid var(--stroke);
    border-radius: 50%;
    background: linear-gradient(145deg, #1a1a21, #22222a);
    color: var(--text-faint);
    font-size: 8.5px;
    font-weight: 600;
    letter-spacing: 0.03em;
  }

  .artist-copy {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .artist-copy strong {
    overflow: hidden;
    color: var(--text-dim);
    font-size: 11px;
    font-weight: 550;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color var(--speed) var(--ease);
  }

  .artist:hover .artist-copy strong {
    color: var(--text);
  }

  .artist-copy span {
    color: var(--text-faint);
    font-size: 9.5px;
  }

  .artist-time {
    flex-shrink: 0;
    color: var(--text-dim);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .share {
    display: block;
    height: 2px;
    margin: 7px 0 0 24px;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.055);
  }

  .share span {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.2));
    transform: scaleX(var(--share));
    transform-origin: left;
    animation: share-in 650ms var(--ease) var(--delay) both;
  }

  .empty {
    margin: auto 0;
    color: var(--text-faint);
    font-size: 11px;
    line-height: 1.5;
  }

  @keyframes dashboard-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  @keyframes share-in {
    from {
      transform: scaleX(0);
    }
  }

  @keyframes pulse-in {
    from {
      transform: scaleY(0);
    }
  }

  @media (max-width: 1100px) {
    .dashboard {
      grid-template-columns: 1fr;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dashboard,
    .share span,
    .week-pulse > span > span {
      animation: none;
    }
  }
</style>
