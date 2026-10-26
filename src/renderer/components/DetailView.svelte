<script lang="ts">
  import type { BrowseResult, CatalogItem } from '@shared/types'
  import { api } from '../lib/api'
  import { artwork } from '../lib/artwork.svelte'
  import { isPlayable, player, toTrack } from '../lib/player.svelte'
  import { nav } from '../lib/nav.svelte'
  import { downloads } from '../lib/downloads.svelte'
  import { cacheDetail, cachedDetail } from '../lib/catalog-cache.svelte'
  import { fitRail } from '../lib/rail-fit'
  import Cover from './Cover.svelte'
  import TrackRow from './TrackRow.svelte'
  import MediaCard from './MediaCard.svelte'
  import EntityLink from './EntityLink.svelte'
  import Icon from './Icon.svelte'

  let { item }: { item: CatalogItem } = $props()

  // Enough rows to be useful without putting thousands of nodes in the DOM.
  const PAGE = 120

  let result = $state<BrowseResult | null>(null)
  let loading = $state(true)
  let error = $state<string | null>(null)
  let shown = $state(PAGE)
  let loadRequest = 0

  const isArtist = $derived(item.kind === 'artist')
  const shelves = $derived(result?.shelves ?? [])
  const songs = $derived((result?.items ?? []).filter((i) => i.kind === 'song' && i.id))

  /** Artist pages: the "Top songs" shelf is the play context; the rest is discography. */
  const topSongs = $derived(
    (shelves.find((shelf) => /top songs/i.test(shelf.title))?.items ?? []).filter(
      (i) => i.kind === 'song' && i.id
    )
  )
  /**
   * Shelves that do not help someone who is here to listen. Videos and live
   * clips belong on YouTube; "Featured on" is a playlist dump that pushes the
   * actual discography down the page.
   */
  const HIDDEN_SHELF = /^(videos|live performances|featured on)$/i

  const trackList = $derived(isArtist ? topSongs : songs)
  const otherShelves = $derived(
    shelves.filter((shelf) => !/top songs/i.test(shelf.title) && !HIDDEN_SHELF.test(shelf.title.trim()))
  )

  // One rail, switchable between release types.
  let activeShelf = $state(0)
  const shelfIndex = $derived(Math.min(activeShelf, Math.max(0, otherShelves.length - 1)))
  const currentShelf = $derived(otherShelves[shelfIndex])

  function shelfLabel(title: string): string {
    if (/^albums$/i.test(title)) return 'Albums'
    if (/singles/i.test(title)) return 'Singles & EPs'
    if (/playlists/i.test(title)) return 'Playlists'
    if (/fans|similar/i.test(title)) return 'Similar artists'
    return title
  }

  const albumCount = $derived(shelves.find((shelf) => /^albums$/i.test(shelf.title))?.items.length ?? 0)
  const singleCount = $derived(
    shelves.find((shelf) => /singles/i.test(shelf.title))?.items.length ?? 0
  )

  const total = $derived(songs.reduce((acc, i) => acc + (i.durationSec ?? 0), 0))
  const art = $derived(result?.header?.thumbnail ?? item.thumbnail)

  let failedBanner = $state<string[]>([])
  const bannerPrimary = $derived(artwork.src(result?.header?.thumbnail ?? item.thumbnail))
  const bannerFallback = $derived(
    result?.header?.thumbnail && item.thumbnail && item.thumbnail !== result.header.thumbnail
      ? artwork.src(item.thumbnail)
      : undefined
  )

  function bannerFailed(src: string | undefined): void {
    if (!src) return
    if (!failedBanner.includes(src)) failedBanner = [...failedBanner, src]
    artwork.broken(src)
  }

  $effect(() => {
    item.id
    failedBanner = []
  })

  /**
   * Some releases (auto-generated singles, photo albums) return rows with no
   * artist at all. The artist is still known from the card that opened the page
   * or the page header, so use that instead of showing "Unknown artist".
   */
  const fallbackArtist = $derived.by(() => {
    const fromItem = item.parts?.find((part) => part.artistId)
    if (fromItem?.artistId) return { name: fromItem.text.trim(), id: fromItem.artistId }
    return result?.header?.artist ?? null
  })

  /** Album headers put the artist in the subtitle; keep it linked. */
  const albumArtist = $derived.by(() => {
    if (item.kind !== 'album') return null
    const fromItem = item.parts?.find((part) => part.artistId || part.entity === 'artist')
    if (fromItem) return { name: fromItem.text.trim(), id: fromItem.artistId }
    if (result?.header?.artist) return result.header.artist

    // Some album headers only carry "Album • 2013". The tracks still know
    // their primary artist; use it when the whole album agrees.
    const credited = new Map<string, string | undefined>()
    for (const song of songs) {
      const part = song.parts?.find((part) => part.artistId || part.entity === 'artist')
      if (!part) continue
      const name = part.text.trim()
      if (name) credited.set(name, part.artistId)
    }
    if (credited.size === 1) {
      const [name, id] = [...credited.entries()][0]
      return { name, id }
    }
    return null
  })
  const albumYear = $derived(
    item.kind === 'album'
      ? (/\b(?:19|20)\d{2}\b/.exec(result?.header?.subtitle ?? '')?.[0] ?? null)
      : null
  )
  const headerSubtitle = $derived(result?.header?.subtitle ?? item.subtitle)

  function withDefaults(track: CatalogItem): CatalogItem {
    let next = track
    if ((track.artists?.length ?? 0) === 0 && fallbackArtist) {
      next = {
        ...track,
        subtitle: fallbackArtist.name,
        artists: [fallbackArtist.name],
        parts: [{ text: fallbackArtist.name, artistId: fallbackArtist.id, entity: 'artist' }]
      }
    }
    // Album rows often omit their own thumbnail. The header cover is the right
    // artwork, and it is what a per-track download should snapshot.
    return next.thumbnail ? next : { ...next, thumbnail: art }
  }

  const displaySongs = $derived(songs.map(withDefaults))

  const collectionKind = $derived(
    item.kind === 'album' || item.kind === 'playlist' ? item.kind : null
  )
  const collectionKey = $derived(
    collectionKind ? `${collectionKind}:${item.browseId ?? item.id}` : null
  )
  const downloadTracks = $derived(displaySongs.map(toTrack))
  const dlCounts = $derived(downloads.countsFor(downloadTracks))
  const fullyDownloaded = $derived(dlCounts.total > 0 && dlCounts.done === dlCounts.total)

  async function downloadCollection(): Promise<void> {
    if (!collectionKind || !collectionKey || downloadTracks.length === 0) return
    if (fullyDownloaded) {
      if (window.confirm(`Remove “${result?.header?.title ?? item.title}” from downloads?`)) {
        await downloads.removeCollection(collectionKey)
      }
      return
    }

    for (const track of downloadTracks) {
      if (downloads.stateFor(track.id) === 'failed') await downloads.retry(track.id)
    }
    await downloads.addCollection(
      {
        key: collectionKey,
        kind: collectionKind,
        title: result?.header?.title ?? item.title,
        thumbnail: art,
        trackIds: downloadTracks.map((track) => track.id)
      },
      downloadTracks
    )
  }

  $effect(() => {
    const browseId = item.browseId ?? item.id
    shown = PAGE
    activeShelf = 0

    // Invalidate any request for the page we were on. The component instance is
    // reused as `item` changes, so an old response must not overwrite this page.
    const request = ++loadRequest

    // Revisiting a page (Back, or the same artist again) should not re-fetch.
    const cached = cachedDetail(browseId)
    if (cached) {
      result = cached
      loading = false
      error = null
      return
    }

    // Nothing in this effect may read `result`: it is written here, and reading
    // it would make the effect its own dependency (that caused a renderer freeze).
    result = null
    void load(browseId, request)
  })

  async function load(browseId: string, request: number): Promise<void> {
    loading = true
    error = null
    try {
      const res = await api.catalog.browse(browseId)
      if (request !== loadRequest) return
      if (res.ok) {
        result = res.data
        cacheDetail(browseId, res.data)
        player.prefetchList(
          res.data.items.filter((i) => i.kind === 'song' && i.id),
          3
        )
      } else {
        result = null
        error = res.error
      }
    } finally {
      if (request === loadRequest) loading = false
    }
  }

  /** Retry after a failed browse without needing to navigate away and back. */
  function retry(): void {
    const browseId = item.browseId ?? item.id
    const request = ++loadRequest
    result = null
    error = null
    loading = true
    void load(browseId, request)
  }

  function playAll(): void {
    void player.playList(isArtist ? trackList : displaySongs, 0)
  }

  /** A discography card either plays (song/video) or opens a page (album/playlist/artist). */
  function activate(items: CatalogItem[], target: CatalogItem): void {
    if (!isPlayable(target)) {
      // Opening an album from its artist page: carry the artist along so its
      // track rows can fall back to it when the API omits it.
      if (target.kind === 'album' && isArtist && item.browseId) {
        const name = result?.header?.title ?? item.title
        const hasArtist = target.parts?.some(
          (part) => part.artistId || part.entity === 'artist'
        )
        nav.open({
          ...target,
          artists: [name],
          parts: hasArtist
            ? target.parts
            : [{ text: name, artistId: item.browseId, entity: 'artist' }]
        })
        return
      }
      nav.open(target)
      return
    }
    const playable = items.filter(isPlayable)
    const index = playable.findIndex((i) => i.id === target.id)
    void player.playList(playable, Math.max(0, index))
  }

  function fmt(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  function countsLabel(done: number, total: number): string {
    return done > 0 ? ` (${done}/${total})` : ''
  }
</script>

<div class="view">
  {#if isArtist}
    <header class="artist-hero">
      <div class="banner">
        {#if bannerFallback && !failedBanner.includes(bannerFallback)}
          <img
            class="banner-art"
            src={bannerFallback}
            alt=""
            decoding="async"
            draggable="false"
            onerror={() => bannerFailed(bannerFallback)}
          />
        {/if}
        {#if bannerPrimary && !failedBanner.includes(bannerPrimary)}
          <img
            class="banner-art"
            src={bannerPrimary}
            alt=""
            decoding="async"
            draggable="false"
            onerror={() => bannerFailed(bannerPrimary)}
          />
        {/if}
        <span class="banner-shade"></span>
        <div class="banner-text">
          <span class="kind">Artist</span>
          <h1>{result?.header?.title ?? item.title}</h1>
          {#if result?.header?.monthlyListeners}
            <p class="listeners">{result.header.monthlyListeners} monthly listeners</p>
          {/if}
        </div>
      </div>

      <div class="artist-actions">
        {#if trackList.length > 0}
          <button class="play-all" onclick={playAll}>
            <Icon name="play" size={14} solid />
            <span>Play all</span>
          </button>
        {/if}
        {#if albumCount > 0 || singleCount > 0}
          <span class="artist-meta">
            {albumCount} albums{singleCount > 0 ? ` · ${singleCount} singles & EPs` : ''}
          </span>
        {:else if trackList.length > 0}
          <span class="artist-meta">{trackList.length} top songs</span>
        {/if}
      </div>
    </header>
  {:else}
    <header class="hero">
      {#if art}
        <span class="glow" style="background-image: url({art})"></span>
      {/if}
      <Cover src={art} size={168} radius={14} alt={result?.header?.title ?? item.title} />
      <div class="hero-text">
        <span class="kind">{item.kind}</span>
        <h1>{result?.header?.title ?? item.title}</h1>
        {#if albumArtist}
          <p class="album-byline">
            <EntityLink kind="artist" id={albumArtist.id} name={albumArtist.name} />
            {#if albumYear}
              <span class="sep">·</span><span>{albumYear}</span>
            {/if}
          </p>
        {:else}
          <p>{headerSubtitle}</p>
        {/if}
        {#if trackList.length > 0}
          <p class="meta">
            {trackList.length} tracks{total ? ` · ${fmt(total)}` : ''}
          </p>
        {/if}
        {#if trackList.length > 0}
          <button class="play-all" onclick={playAll}>
            <Icon name="play" size={14} solid />
            <span>Play all</span>
          </button>
        {/if}
        {#if collectionKey && downloadTracks.length > 0}
          <button
            class="download-all"
            class:on={fullyDownloaded}
            title={fullyDownloaded ? 'Downloaded — click to remove' : 'Download this collection'}
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
              <span>Download{countsLabel(dlCounts.done, dlCounts.total)}</span>
            {/if}
          </button>
        {/if}
      </div>
    </header>
  {/if}

  {#if error}
    <div class="notice">
      <strong>Could not open this</strong>
      <span>{error}</span>
      <button class="retry" onclick={retry}>Try again</button>
    </div>
  {/if}

  {#if loading}
    <p class="placeholder">Loading…</p>
  {:else if isArtist && (trackList.length > 0 || otherShelves.length > 0)}
    {#if trackList.length > 0}
      <section class="shelf">
        <h2>Top songs</h2>
        <ol class="tracks">
          {#each trackList as track, i (track.id + i)}
            <TrackRow
              item={track}
              context={trackList}
              index={i}
              showIndex
              onQueue={(t) => player.enqueue(t)}
            />
          {/each}
        </ol>
      </section>
    {/if}

    {#if currentShelf && otherShelves.length > 0}
      <section class="shelf">
        <div class="tabs" role="tablist" aria-label="Release type">
          {#each otherShelves as shelf, i (shelf.title)}
            <button
              class="tab"
              class:on={i === shelfIndex}
              role="tab"
              aria-selected={i === shelfIndex}
              onclick={() => (activeShelf = i)}
            >
              {shelfLabel(shelf.title)}
            </button>
          {/each}
        </div>

        {#key shelfIndex}
          <div class="rail" use:fitRail>
            {#each currentShelf.items as entry (entry.kind + entry.id + entry.title)}
              <MediaCard item={entry} onActivate={(target) => activate(currentShelf.items, target)} />
            {/each}
          </div>
        {/key}
      </section>
    {/if}
  {:else if displaySongs.length > 0}
    <ol class="tracks">
      {#each displaySongs.slice(0, shown) as track, i (track.id + i)}
        <TrackRow
          item={track}
          context={displaySongs}
          index={i}
          showIndex
          showArt={false}
          onQueue={(t) => player.enqueue(t)}
        />
      {/each}
    </ol>
    {#if displaySongs.length > shown}
      <button class="more" onclick={() => (shown += PAGE)}>Show {displaySongs.length - shown} more</button>
    {/if}
  {:else}
    <p class="placeholder">Nothing playable here yet.</p>
  {/if}
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 26px;
    padding: 2px 2px 20px;
  }

  .artist-hero {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .banner {
    position: relative;
    /* Pull the banner through the content padding so it meets the titlebar and
       the window edges. Everything below it keeps the normal content gutter. */
    margin: calc(-1 * (var(--content-y, 20px) + 2px)) calc(-1 * (var(--content-x, 26px) + 2px)) 0;
    height: clamp(250px, 28vw, 360px);
    border-radius: 0;
    overflow: hidden;
    background: #101014;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
  }

  .banner-art {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 28%;
  }

  .banner-shade {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(
        to top,
        rgba(8, 8, 11, 0.95) 0%,
        rgba(8, 8, 11, 0.5) 36%,
        rgba(8, 8, 11, 0.06) 100%
      ),
      linear-gradient(
        to right,
        rgba(8, 8, 11, 0.62) 0%,
        rgba(8, 8, 11, 0.14) 55%,
        transparent 100%
      );
  }

  .banner-text {
    position: absolute;
    left: 28px;
    right: 28px;
    bottom: 22px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .banner .kind {
    color: rgba(255, 255, 255, 0.55);
  }

  .banner h1 {
    margin: 0;
    color: #fff;
    font-size: clamp(34px, 4.5vw, 54px);
    font-weight: 650;
    letter-spacing: -0.04em;
    line-height: 1.02;
    text-shadow: 0 2px 24px rgba(0, 0, 0, 0.35);
  }

  .listeners {
    margin: 1px 0 0;
    color: rgba(255, 255, 255, 0.68);
    font-size: 13px;
  }

  .artist-actions {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 2px;
  }

  .artist-actions .play-all {
    margin-top: 0;
  }

  .artist-meta {
    color: var(--text-faint);
    font-size: 12px;
  }

  .hero {
    position: relative;
    isolation: isolate;
    display: flex;
    gap: 22px;
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
    font-size: 38px;
    font-weight: 650;
    margin: 5px 0 7px;
    letter-spacing: -0.035em;
    line-height: 1.08;
  }

  .hero-text p {
    margin: 0 0 4px;
    color: var(--text-dim);
    font-size: 13px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    max-width: 720px;
  }

  .album-byline .sep {
    margin: 0 6px;
    color: var(--text-faint);
  }

  .meta {
    color: var(--text-faint) !important;
    font-size: 12px !important;
    -webkit-line-clamp: 1 !important;
    line-clamp: 1 !important;
  }

  .play-all {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
    padding: 9px 20px 9px 17px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 550;
    color: #08080b;
    background: var(--text);
    transition: transform var(--speed) var(--ease);
  }

  .play-all:hover {
    transform: translateY(-1px);
  }

  .download-all {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 14px 0 0 8px;
    padding: 8px 16px;
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

  .download-all:hover {
    border-color: var(--stroke-strong);
    color: var(--text);
    background: var(--glass-hover);
  }

  .download-all.on {
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

  .shelf {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  h2 {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    letter-spacing: -0.012em;
  }

  .tabs {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .tab {
    border: 1px solid var(--stroke);
    border-radius: 999px;
    padding: 6px 14px;
    font-size: 12.5px;
    color: var(--text-dim);
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease),
      border-color var(--speed) var(--ease);
  }

  .tab:hover {
    color: var(--text);
    border-color: var(--stroke-strong);
  }

  .tab.on {
    background: var(--text);
    border-color: transparent;
    color: #08080b;
    font-weight: 550;
  }

  .rail {
    display: flex;
    gap: 18px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 2px 4px 8px;
    margin: -2px -4px 0;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
  }

  .rail::-webkit-scrollbar {
    height: 8px;
  }

  .rail::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 999px;
  }

  .tracks {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .more {
    align-self: flex-start;
    border: 1px solid var(--stroke);
    border-radius: 999px;
    padding: 8px 16px;
    color: var(--text-dim);
    font-size: 12px;
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .more:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .notice {
    display: flex;
    flex-direction: column;
    gap: 3px;
    border-radius: var(--radius-lg);
    padding: 11px 14px;
    font-size: 13px;
    border: 1px solid rgba(255, 128, 128, 0.28);
    background: rgba(255, 128, 128, 0.08);
  }

  .notice span {
    color: var(--text-dim);
    font-size: 12.5px;
  }

  .notice .retry {
    align-self: flex-start;
    margin-top: 6px;
    border: 1px solid var(--stroke);
    border-radius: 999px;
    padding: 5px 12px;
    color: var(--text);
    font-size: 12px;
  }

  .notice .retry:hover {
    background: var(--glass-hover);
  }

  .placeholder {
    color: var(--text-faint);
    font-size: 13px;
  }
</style>
