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
  import PixelClock from './PixelClock.svelte'
  import TrackRow from './TrackRow.svelte'

  let { items, summary }: { items: CatalogItem[]; summary: ListeningSummary } = $props()

  const DAY_MS = 24 * 60 * 60 * 1000
  const latest = $derived(items[0])
  const artists = $derived(summary.artists.filter((artist) => artist.name !== 'Unknown artist'))

  /**
   * Weekly listening shown as H:MM. The badge is a dot-matrix clock, not a
   * time of day: 17 hours and 22 minutes across the last seven days.
   */
  const clock = $derived.by(() => {
    const totalMinutes = Math.max(0, Math.round(summary.totalSeconds / 60))
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return {
      hasTime: summary.totalSeconds > 0 || summary.plays === 0,
      value: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
      label: `${plural(hours, 'hour', 'hours')} ${plural(minutes, 'minute', 'minutes')} listened this week`
    }
  })

  const fallbackLabel = $derived(plural(summary.plays, 'play', 'plays'))

  const totalDetail = $derived.by(() => {
    if (summary.plays === 0) return 'Nothing played yet'
    const plays = plural(summary.plays, 'play', 'plays')
    const songs = plural(summary.uniqueTracks, 'song', 'songs')
    return summary.totalSeconds > 0 ? `${plays} · ${songs}` : songs
  })

  /**
   * The busiest 24-hour bucket, labelled from its end date: the window is
   * rolling, so the end of the bucket is the calendar day it mostly covers.
   */
  const bestDay = $derived.by(() => {
    if (summary.plays === 0) return null
    const byTime = summary.totalSeconds > 0
    let best = 0
    for (let i = 1; i < summary.days.length; i++) {
      const value = byTime ? summary.days[i].seconds : summary.days[i].plays
      const current = byTime ? summary.days[best].seconds : summary.days[best].plays
      if (value > current) best = i
    }
    const bucket = summary.days[best]
    if ((byTime ? bucket.seconds : bucket.plays) <= 0) return null

    const end = new Date(summary.since + (best + 1) * DAY_MS - 1)
    return {
      label: new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(end),
      seconds: bucket.seconds
    }
  })

  let artistImages = $state<Record<string, string | null>>({})
  const pendingImages = new Set<string>()

  $effect(() => {
    for (const artist of artists.slice(0, 4)) {
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

  function plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`
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
    <header class="week-head">
      <div class="week-title">
        <h2>Vibing Time <span>this week</span></h2>
        <p class="week-sub">{totalDetail}</p>
      </div>
      <span
        class="week-clock"
        class:text={!clock.hasTime}
        title={clock.hasTime ? clock.label : `${fallbackLabel} this week`}
      >
        {#if clock.hasTime}
          <PixelClock value={clock.value} label={clock.label} height={38} units />
        {:else}
          <span class="week-clock-text">{fallbackLabel}</span>
        {/if}
      </span>
    </header>

    <span class="list-label">Top artists</span>
    {#if artists.length > 0}
      <div class="artist-list">
        {#each artists.slice(0, 4) as artist, i (artist.key)}
          <button class="artist" onclick={() => openArtist(artist)} title={`Open ${artist.name}`}>
            <span class="rank tabular">{String(i + 1).padStart(2, '0')}</span>
            {#if artistImages[artist.key]}
              <Cover src={artwork.src(artistImages[artist.key] ?? undefined)} size={36} radius={18} alt="" />
            {:else}
              <span class="artist-monogram" aria-hidden="true">{monogram(artist.name)}</span>
            {/if}
            <span class="artist-copy">
              <strong class="truncate">{artist.name}</strong>
              <span>{plural(artist.plays, 'play', 'plays')} · {plural(artist.tracks, 'song', 'songs')}</span>
            </span>
            {#if artist.seconds > 0}
              <span class="artist-time">{listeningTime(artist.seconds)}</span>
            {/if}
          </button>
        {/each}
      </div>
    {:else}
      <p class="empty artists-empty">
        {summary.plays > 0
          ? 'Artist names will appear as Viby learns more from the catalogue.'
          : 'Play something to start your weekly snapshot.'}
      </p>
    {/if}

    {#if bestDay}
      <p class="week-note">
        <span>Most active day</span>
        <span>
          <strong>{bestDay.label}</strong>
          {#if bestDay.seconds > 0}<span class="note-sep">·</span> {listeningTime(bestDay.seconds)}{/if}
        </span>
      </p>
    {/if}
  </aside>
</section>

<style>
  .dashboard {
    display: grid;
    /* The two cards carry equal weight: the history list and the weekly
       snapshot are peers, not a main panel with a sidebar. */
    grid-template-columns: repeat(2, minmax(0, 1fr));
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

  .week-head {
    /* Align the title with the peer card's title, which sits under an eyebrow
       of its own. The badge keeps the time on this line. */
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    margin-top: 14px;
  }

  .week-title {
    min-width: 0;
  }

  .week-head h2 {
    margin: 0;
    white-space: nowrap;
  }

  .week-head h2 span {
    color: var(--text-faint);
    font-weight: 500;
  }

  .week-sub {
    margin: 3px 0 0;
    color: var(--text-faint);
    font-size: 10.5px;
  }

  .week-clock {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
    color: var(--text);
  }

  .week-clock.text {
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .week-clock-text {
    font-variant-numeric: tabular-nums;
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

  .list-label {
    margin-top: 18px;
    color: var(--text-faint);
    font-size: 10px;
  }

  .artist-list {
    display: flex;
    flex-direction: column;
    margin-top: 2px;
  }

  .artist {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 0;
    border-top: 1px solid var(--stroke);
    text-align: left;
  }

  .artist:first-child {
    border-top: 0;
  }

  .rank {
    width: 18px;
    flex-shrink: 0;
    color: var(--text-faint);
    font-size: 9.5px;
  }

  .artist-monogram {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border: 1px solid var(--stroke);
    border-radius: 50%;
    background: linear-gradient(145deg, #1a1a21, #22222a);
    color: var(--text-faint);
    font-size: 9px;
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
    color: var(--text-dim);
    font-size: 12px;
    font-weight: 550;
    transition: color var(--speed) var(--ease);
  }

  .artist:hover .artist-copy strong,
  .artist:focus-visible .artist-copy strong {
    color: var(--text);
  }

  .artist-copy span {
    color: var(--text-faint);
    font-size: 9.5px;
  }

  .artist-time {
    flex-shrink: 0;
    color: var(--text-dim);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }

  .week-note {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin: auto 0 0;
    padding-top: 12px;
    border-top: 1px solid var(--stroke);
    color: var(--text-faint);
    font-size: 10.5px;
  }

  .week-note strong {
    color: var(--text-dim);
    font-weight: 550;
  }

  .note-sep {
    margin: 0 2px;
    color: var(--text-faint);
  }

  .empty {
    margin: auto 0;
    color: var(--text-faint);
    font-size: 11px;
    line-height: 1.5;
  }

  .artists-empty {
    margin: 10px 0 0;
  }

  @keyframes dashboard-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  @media (max-width: 1100px) {
    .dashboard {
      grid-template-columns: 1fr;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dashboard {
      animation: none;
    }
  }
</style>
