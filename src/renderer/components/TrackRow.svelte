<script lang="ts">
  import type { CatalogItem, SubtitlePart } from '@shared/types'
  import { isPlayable, player, toTrack } from '../lib/player.svelte'
  import { nav } from '../lib/nav.svelte'
  import { openArtist } from '../lib/artist'
  import { playlistPicker } from '../lib/playlist-picker.svelte'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'

  let {
    item,
    index,
    context,
    onQueue,
    onRemove,
    showIndex = false,
    showArt = true
  }: {
    item: CatalogItem
    index?: number
    context?: CatalogItem[]
    onQueue?: (item: CatalogItem) => void
    onRemove?: (item: CatalogItem) => void
    showIndex?: boolean
    /** Album/playlist pages already show the artwork on the page itself. */
    showArt?: boolean
  } = $props()

  // A track may have been swapped to its official audio release; the row still
  // belongs to the id it was launched from.
  const active = $derived(
    player.current?.id === item.id ||
      (player.current?.sourceId != null && player.current.sourceId === item.id)
  )
  const playing = $derived(active && player.playing)
  const playable = $derived(isPlayable(item))
  const rounded = $derived(item.kind === 'artist')

  let hoverTimer: ReturnType<typeof setTimeout> | null = null

  function hoverStart(): void {
    if (!playable) return
    hoverTimer = setTimeout(() => player.prefetch(item.id), 80)
  }

  function hoverEnd(): void {
    if (hoverTimer) {
      clearTimeout(hoverTimer)
      hoverTimer = null
    }
  }

  function activate(): void {
    if (playable) {
      void player.playList(context ?? [item], index ?? 0)
    } else {
      nav.open(item)
    }
  }

  function openPart(event: MouseEvent, part: SubtitlePart): void {
    event.stopPropagation()
    if (part.artistId) {
      openArtist(part.artistId, part.text)
    } else if (part.albumId) {
      nav.open({
        id: part.albumId,
        browseId: part.albumId,
        kind: 'album',
        title: part.text,
        subtitle: 'Album'
      })
    }
  }

  function fmt(seconds?: number): string {
    if (!seconds) return ''
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }
</script>

<li class="row" class:active onpointerenter={hoverStart} onpointerleave={hoverEnd}>
  <div
    class="main"
    role="button"
    tabindex="0"
    title={playable ? 'Play' : 'Open'}
    onclick={activate}
    onkeydown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        activate()
      }
    }}
  >
    <span class="idx">
      {#if playing}
        <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
      {:else if showIndex}
        <span class="tabular">{index !== undefined ? index + 1 : ''}</span>
      {/if}
    </span>

    {#if showArt}
      <Cover src={item.thumbnail} size={40} radius={rounded ? 20 : 6} alt={item.title} />
    {/if}

    <span class="text">
      <span class="title truncate">{item.title}</span>
      <span class="sub truncate">
        {#if item.kind !== 'song'}<span class="tag">{item.kind}</span>{/if}
        {#if item.parts?.length}
          {#each item.parts as part, i (i)}
            {#if part.artistId || part.albumId}
              <button class="inline-link" onclick={(event) => openPart(event, part)}>{part.text}</button>
            {:else}
              <span>{part.text}</span>
            {/if}
          {/each}
        {:else}
          {item.subtitle}
        {/if}
        {#if item.views}
          <span class="views">{item.parts?.length ? ' · ' : ''}{item.views}</span>
        {/if}
      </span>
    </span>

    <span class="dur tabular">{fmt(item.durationSec)}</span>
  </div>

  {#if playable}
    <button
      class="row-action"
      title="Add to playlist"
      aria-label="Add to playlist"
      onclick={(event) => {
        event.stopPropagation()
        playlistPicker.show(toTrack(item), event.currentTarget as HTMLElement)
      }}
    >
      <Icon name="list" size={15} />
    </button>
    {#if onQueue}
      <button
        class="row-action"
        title="Add to queue"
        aria-label="Add to queue"
        onclick={(event) => {
          event.stopPropagation()
          onQueue(item)
        }}
      >
        <Icon name="plus" size={15} />
      </button>
    {/if}
  {/if}

  {#if onRemove}
    <button
      class="row-action"
      title="Remove"
      aria-label="Remove"
      onclick={(event) => {
        event.stopPropagation()
        onRemove(item)
      }}
    >
      <Icon name="close" size={14} />
    </button>
  {/if}
</li>

<style>
  .row {
    display: flex;
    align-items: center;
    border-radius: 10px;
    min-width: 0;
    transition: background var(--speed) var(--ease);
  }

  .row:hover {
    background: var(--glass-hover);
  }

  .row.active {
    background: var(--glass-active);
  }

  .main {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 7px 10px;
    min-width: 0;
    text-align: left;
    cursor: pointer;
    border-radius: 10px;
  }

  .idx {
    width: 16px;
    flex-shrink: 0;
    color: var(--text-faint);
    font-size: 11.5px;
    text-align: right;
    display: grid;
    place-items: center;
  }

  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
    gap: 1px;
  }

  .title {
    font-size: 13.5px;
    font-weight: 480;
  }

  .active .title {
    color: var(--text);
  }

  .sub {
    font-size: 12px;
    color: var(--text-faint);
  }

  .inline-link {
    display: inline;
    padding: 0;
    color: var(--text-dim);
    font: inherit;
    transition: color var(--speed) var(--ease);
  }

  .inline-link:hover {
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .tag {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    border: 1px solid var(--stroke);
    border-radius: 4px;
    padding: 0 4px;
    margin-right: 6px;
    color: var(--text-faint);
  }

  .views {
    color: var(--text-faint);
    font-size: 11.5px;
  }

  .dur {
    color: var(--text-faint);
    font-size: 11.5px;
    padding-left: 8px;
    font-variant-numeric: tabular-nums;
  }

  .row-action {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-right: 4px;
    border-radius: 7px;
    color: var(--text-faint);
    opacity: 0;
    transition:
      opacity var(--speed) var(--ease),
      color var(--speed) var(--ease),
      background var(--speed) var(--ease);
  }

  .row:hover .row-action {
    opacity: 1;
  }

  .row-action:hover {
    color: var(--text);
    background: var(--glass-hover);
  }

  /* Three bars that dance while this row is the playing one. */
  .eq {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 11px;
  }

  .eq i {
    width: 2px;
    border-radius: 1px;
    background: var(--accent);
    animation: bounce 900ms ease-in-out infinite;
  }

  .eq i:nth-child(1) {
    height: 5px;
    animation-delay: -200ms;
  }

  .eq i:nth-child(2) {
    height: 11px;
    animation-delay: -500ms;
  }

  .eq i:nth-child(3) {
    height: 7px;
    animation-delay: -100ms;
  }

  @keyframes bounce {
    0%,
    100% {
      transform: scaleY(0.4);
    }
    50% {
      transform: scaleY(1);
    }
  }
</style>
