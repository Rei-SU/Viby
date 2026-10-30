<script lang="ts">
  import type { CatalogItem } from '@shared/types'
  import { api } from '../lib/api'
  import type { ArtistIdentity } from '@shared/entity-identity'
  import { withFallbackArtist } from '@shared/entity-identity'
  import type { ArtistRelease } from '../lib/artist-releases'
  import { cachedDetail, cacheDetail } from '../lib/catalog-cache.svelte'
  import { nav } from '../lib/nav.svelte'
  import { network } from '../lib/network.svelte'
  import { player } from '../lib/player.svelte'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'
  import TrackRow from './TrackRow.svelte'

  let {
    release,
    divided = false,
    fallbackArtist
  }: { release: ArtistRelease; divided?: boolean; fallbackArtist?: ArtistIdentity } = $props()

  let rootEl = $state<HTMLElement>()
  let songs = $state<CatalogItem[]>([])
  let loading = $state(false)
  let error = $state<string | null>(null)
  let started = false

  const title = $derived(release.item.title)

  // A full discography can hold dozens of releases. Fetch a track list only
  // when its release is close to the viewport, then keep it cached.
  $effect(() => {
    const element = rootEl
    if (!element || started) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        started = true
        observer.disconnect()
        void load()
      },
      { rootMargin: '500px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  })

  async function load(): Promise<void> {
    const id = release.item.id
    const cached = cachedDetail(id)
    if (cached) {
      songs = songsOf(cached)
      return
    }
    if (network.localFirst) {
      error = 'Connect to load this release.'
      return
    }

    loading = true
    error = null
    const res = await api.catalog.browse(id)
    loading = false
    if (!res.ok) {
      error = res.error
      return
    }
    cacheDetail(id, res.data)
    songs = songsOf(res.data)
  }

  function songsOf(data: { items?: CatalogItem[] }): CatalogItem[] {
    return (data.items ?? [])
      .filter((item) => item.kind === 'song' && item.id)
      .map((item) => withFallbackArtist(item, fallbackArtist))
  }

  function retry(): void {
    void load()
  }

  function play(): void {
    if (songs.length > 0) void player.playList(songs, 0)
  }

  function open(): void {
    nav.open(release.item)
  }

  const count = $derived(
    songs.length > 0
      ? `${songs.length} ${songs.length === 1 ? 'song' : 'songs'}`
      : null
  )
</script>

<section class="release" class:divided bind:this={rootEl}>
  <div class="head">
    <Cover src={release.item.thumbnail} size={96} radius={11} alt={title} />
    <div class="text">
      <button class="title truncate" title={`Open ${title}`} onclick={open}>{title}</button>
      <span class="meta">
        {release.item.subtitle}
        {#if count}<span class="sep">·</span>{count}{/if}
      </span>
    </div>
    <button
      class="play"
      title={count ? `Play ${title}` : 'Loading songs…'}
      aria-label={`Play ${title}`}
      disabled={songs.length === 0}
      onclick={play}
    >
      <Icon name="play" size={14} solid />
    </button>
  </div>

  {#if loading}
    <p class="note">Loading songs…</p>
  {:else if error}
    <p class="note">
      {error}
      <button class="retry" onclick={retry}>Retry</button>
    </p>
  {:else if songs.length > 0}
    <ol class="tracks">
      {#each songs as song, i (song.id + i)}
        <TrackRow
          item={song}
          context={songs}
          index={i}
          showIndex
          showArt={false}
          onQueue={(item) => player.enqueue(item)}
        />
      {/each}
    </ol>
  {/if}
</section>

<style>
  .release {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 22px 0;
  }

  .release:first-child {
    padding-top: 2px;
  }

  .release.divided {
    border-top: 1px solid var(--stroke);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 18px;
    min-width: 0;
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .title {
    align-self: flex-start;
    max-width: 100%;
    color: var(--text);
    font-size: 20px;
    font-weight: 650;
    letter-spacing: -0.02em;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-faint);
    font-size: 13px;
  }

  .sep {
    opacity: 0.6;
  }

  .play {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    flex: none;
    border-radius: 50%;
    background: var(--text);
    color: var(--bg);
    transition: transform var(--speed) var(--ease);
  }

  .play:hover:not(:disabled) {
    transform: scale(1.05);
  }

  .play:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .note {
    margin: 0 0 2px 114px;
    color: var(--text-faint);
    font-size: 12px;
  }

  .retry {
    margin-left: 6px;
    color: var(--text-dim);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .retry:hover {
    color: var(--text);
  }

  .tracks {
    list-style: none;
    margin: 0;
    padding: 0;
  }
</style>
