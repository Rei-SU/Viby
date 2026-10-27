<script lang="ts">
  import type { ListeningArtist, ListeningSummary, RecentGroup } from '@shared/listening'
  import { albumMatch, artistMatch } from '@shared/listening'
  import type { CatalogItem } from '@shared/types'
  import { api } from '../lib/api'
  import { player } from '../lib/player.svelte'
  import { nav } from '../lib/nav.svelte'
  import { searchState } from '../lib/search.svelte'
  import { artwork } from '../lib/artwork.svelte'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'

  let { groups, summary }: { groups: RecentGroup[]; summary: ListeningSummary } = $props()

  const latest = $derived(groups[0]?.tracks[0])
  const totalLabel = $derived(
    summary.totalSeconds > 0 ? listeningTime(summary.totalSeconds) : `${summary.uniqueTracks} songs`
  )
  const totalDetail = $derived(
    summary.totalSeconds > 0 ? `${summary.uniqueTracks} songs` : 'this week'
  )
  const artists = $derived(summary.artists.filter((artist) => artist.name !== 'Unknown artist'))

  let artistImages = $state<Record<string, string | null>>({})
  let opening = $state<string | null>(null)
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

  function trackTime(seconds: number | undefined): string {
    if (!seconds || seconds <= 0) return ''
    const total = Math.round(seconds)
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  }

  function play(item: CatalogItem): void {
    void player.playList([item], 0)
  }

  function openGroup(group: RecentGroup): void {
    if (opening) return
    if (group.albumId) {
      openRelease(group, group.albumId)
      return
    }
    if (!group.key.startsWith('album:') && group.artistId) {
      nav.openArtist(group.artistId, group.artist, group.thumbnail)
      return
    }
    opening = group.key
    void resolveGroup(group)
  }

  function openRelease(group: RecentGroup, albumId: string): void {
    nav.open({
      id: albumId,
      browseId: albumId,
      kind: 'album',
      title: group.title,
      subtitle: group.artist,
      thumbnail: group.thumbnail,
      artists: [group.artist],
      parts: group.artistId
        ? [{ text: group.artist, artistId: group.artistId, entity: 'artist' }]
        : undefined
    })
  }

  /**
   * Old history entries carry the release name but not its id. The id is in the
   * song's own credits, so look the track up and read it from there: a name
   * search cannot tell the twenty releases called "Sociopath" apart.
   */
  async function releaseIdFor(group: RecentGroup): Promise<string | null> {
    for (const track of group.tracks.slice(0, 2)) {
      const result = await api.catalog.search(`${track.title} ${group.artist}`, 'songs')
      if (!result.ok) continue
      const hit = result.data.find((item) => item.id === track.id)
      const albumId = hit?.parts?.find((part) => part.albumId)?.albumId
      if (albumId) return albumId
    }
    return null
  }

  async function resolveGroup(group: RecentGroup): Promise<void> {
    const isAlbum = group.key.startsWith('album:')
    try {
      if (isAlbum) {
        const albumId = await releaseIdFor(group)
        if (albumId) {
          openRelease(group, albumId)
          return
        }
        const result = await api.catalog.search(group.title, 'albums')
        if (result.ok) {
          const match = albumMatch(result.data, group)
          if (match) {
            nav.open(match)
            return
          }
        }
      } else {
        const result = await api.catalog.search(group.artist, 'artists')
        if (result.ok) {
          const match = artistMatch(result.data, group)
          if (match) {
            nav.open(match)
            return
          }
        }
      }
    } catch {
      // Fall through to the artist page or the prefilled search.
    } finally {
      opening = null
    }

    // A same-named release is not evidence that it is the right one. The artist
    // is known, so land on their page instead of a stranger's album.
    if (group.artistId) {
      nav.openArtist(group.artistId, group.artist, group.thumbnail)
      return
    }
    const query = isAlbum ? group.title : group.artist
    searchState.setQuery(query)
    searchState.submit(isAlbum ? 'albums' : 'artists')
    nav.go('search')
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
      {#if latest}
        <button class="resume" onclick={() => play(latest)}>
          <Icon name="play" size={11} solid /> Resume
        </button>
      {/if}
    </header>

    <div class="recent-grid">
      {#each groups as group (group.key)}
        <article class="recent-group">
          <button
            class="group-head"
            class:opening={opening === group.key}
            title={group.title}
            disabled={opening === group.key}
            onclick={() => openGroup(group)}
          >
            <Cover src={artwork.src(group.thumbnail)} size={42} radius={9} alt="" />
            <span class="group-copy">
              <strong>{group.title}</strong>
              <span>{group.artist}</span>
            </span>
            <Icon name="forward" size={12} />
          </button>

          <div class="group-tracks">
            {#each group.tracks as track (track.id)}
              <button class="track" title={track.title} onclick={() => play(track)}>
                <span class="track-title">{track.title}</span>
                <span class="track-time">{trackTime(track.durationSec)}</span>
                <span class="track-play" aria-hidden="true"><Icon name="play" size={10} solid /></span>
              </button>
            {/each}
          </div>
        </article>
      {/each}
    </div>
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

  .recent-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .recent-group {
    min-width: 0;
    padding: 9px;
    border: 1px solid rgba(255, 255, 255, 0.045);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.018);
  }

  .group-head {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    min-width: 0;
    margin-bottom: 8px;
    color: var(--text-dim);
    text-align: left;
    transition: opacity var(--speed) var(--ease);
  }

  .group-head.opening {
    opacity: 0.55;
  }

  .group-copy {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .group-copy strong,
  .group-copy span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .group-copy strong {
    color: var(--text);
    font-size: 12px;
    font-weight: 550;
  }

  .group-copy span {
    color: var(--text-faint);
    font-size: 10.5px;
  }

  .group-tracks {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .track {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    min-width: 0;
    padding: 6px 7px;
    border-radius: 7px;
    color: var(--text-dim);
    font-size: 11.5px;
    text-align: left;
    transition:
      color var(--speed) var(--ease),
      background var(--speed) var(--ease);
  }

  .track:hover,
  .track:focus-visible {
    background: var(--glass-hover);
    color: var(--text);
  }

  .track-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .track-time {
    color: var(--text-faint);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .track-play {
    display: none;
    color: var(--text);
  }

  .track:hover .track-play,
  .track:focus-visible .track-play {
    display: inline-flex;
  }

  .track:hover .track-time,
  .track:focus-visible .track-time {
    display: none;
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

  @media (max-width: 680px) {
    .recent-grid {
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
