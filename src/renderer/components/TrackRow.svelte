<script lang="ts">
  import type { CatalogItem } from '@shared/types'
  import { isPlayable, player, toTrack } from '../lib/player.svelte'
  import { nav } from '../lib/nav.svelte'
  import { playlistPicker } from '../lib/playlist-picker.svelte'
  import { downloads } from '../lib/downloads.svelte'
  import { favorites } from '../lib/favorites.svelte'
  import { network } from '../lib/network.svelte'
  import { openTrackFromItem } from '../lib/release'
  import { TRACK_DRAG_TYPE, trackDrag } from '../lib/track-drag.svelte'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'
  import SubtitleParts from './SubtitleParts.svelte'

  let {
    item,
    index,
    contextIndex,
    context,
    onQueue,
    onRemove,
    showIndex = false,
    showArt = true,
    showDownload = true,
    showFavorite = false,
    unavailable = false,
    focused = false,
    meta
  }: {
    item: CatalogItem
    index?: number
    /** Position inside `context` when the context is a filtered (offline) list. */
    contextIndex?: number
    context?: CatalogItem[]
    onQueue?: (item: CatalogItem) => void
    onRemove?: (item: CatalogItem) => void
    showIndex?: boolean
    /** Album/playlist pages already show the artwork on the page itself. */
    showArt?: boolean
    /** Off on library rows where removal is the row action. */
    showDownload?: boolean
    /** Home and history rows offer the heart; dense catalog rows do not. */
    showFavorite?: boolean
    /** Offline and not downloaded: visible for context, but inert and faded. */
    unavailable?: boolean
    /** Briefly flash the row after a song title opened its release here. */
    focused?: boolean
    /** Small right-aligned annotation, e.g. "12 MB · Best". */
    meta?: string
  } = $props()

  // A track may have been swapped to its official audio release; the row still
  // belongs to the id it was launched from.
  const active = $derived(
    player.current?.id === item.id ||
      (player.current?.sourceId != null && player.current.sourceId === item.id)
  )
  const playing = $derived(active && player.playing)
  const playable = $derived(isPlayable(item))
  const downloaded = $derived(downloads.downloaded(item.id))
  const favorited = $derived(favorites.has(item.id))
  /**
   * With no usable connection, only explicit downloads are real. The invisible
   * audio cache is not a download and must never make a row look playable.
   */
  const offlineBlocked = $derived(playable && network.offline && !downloaded)
  const blocked = $derived(unavailable || offlineBlocked)
  const canPlay = $derived(playable && !blocked)
  /**
   * Hover actions take no room until the row is hovered, so the row's width
   * budget has to know how many buttons will slide in. Each is a 28px box plus
   * a 4px gap (`--actions-w`).
   */
  const actionCount = $derived(
    (canPlay && showFavorite ? 1 : 0) +
      (canPlay && showDownload ? 1 : 0) +
      (canPlay ? 1 : 0) +
      (canPlay && onQueue ? 1 : 0) +
      (onRemove ? 1 : 0)
  )
  const rounded = $derived(item.kind === 'artist')
  const dragging = $derived(trackDrag.active && trackDrag.sourceId === item.id)
  const downloadState = $derived(downloads.stateFor(item.id))
  const downloadJob = $derived(downloads.jobFor(item.id))
  const art = $derived(downloads.entryFor(item.id)?.artUrl ?? item.thumbnail)
  const downloadTitle = $derived.by(() => {
    switch (downloadState) {
      case 'done':
        return 'Downloaded — click to remove'
      case 'downloading':
        return `Downloading ${downloadJob?.percent ?? 0}% — click to cancel`
      case 'queued':
        return 'Queued — click to cancel'
      case 'paused':
        return 'Paused — click to cancel'
      case 'failed':
        return 'Download failed — click to retry'
      default:
        return 'Download'
    }
  })

  let hoverTimer: ReturnType<typeof setTimeout> | null = null

  function hoverStart(): void {
    if (!canPlay) return
    hoverTimer = setTimeout(() => player.prefetch(item.id), 80)
  }

  function hoverEnd(): void {
    if (hoverTimer) {
      clearTimeout(hoverTimer)
      hoverTimer = null
    }
  }

  function activate(): void {
    if (canPlay) {
      void player.playList(context ?? [item], contextIndex ?? index ?? 0)
    } else if (!blocked) {
      nav.open(item)
    }
  }

  /**
   * A compact cover+title card instead of a snapshot of the whole row, so the
   * drag reads as "a song in hand" rather than a 500px slab of interface.
   */
  function dragGhost(): HTMLElement {
    const ghost = document.createElement('div')
    ghost.style.cssText = [
      'position:fixed',
      'top:-1000px',
      'left:-1000px',
      'display:flex',
      'align-items:center',
      'gap:10px',
      'max-width:260px',
      'padding:8px 14px 8px 8px',
      'border-radius:10px',
      'background:rgba(26,26,32,.96)',
      'border:1px solid rgba(255,255,255,.14)',
      'box-shadow:0 14px 34px rgba(0,0,0,.55)',
      'color:#f2f2f5',
      'font:600 12.5px/1.35 -apple-system, "Segoe UI", Inter, sans-serif'
    ].join(';')

    if (art) {
      const img = document.createElement('img')
      img.src = art
      img.draggable = false
      img.style.cssText =
        'width:34px;height:34px;border-radius:6px;object-fit:cover;flex:none'
      ghost.append(img)
    }

    const copy = document.createElement('div')
    copy.style.cssText = 'min-width:0;display:flex;flex-direction:column;gap:1px'
    const title = document.createElement('span')
    title.textContent = item.title
    title.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
    const hint = document.createElement('span')
    hint.textContent = 'Add to queue'
    hint.style.cssText = 'color:rgba(255,255,255,.55);font-weight:500;font-size:10.5px'
    copy.append(title, hint)
    ghost.append(copy)

    document.body.append(ghost)
    // Chromium snapshots the element during dragstart; it can go straight after.
    setTimeout(() => ghost.remove(), 0)
    return ghost
  }

  function dragStart(event: DragEvent): void {
    if (!canPlay || !event.dataTransfer) {
      event.preventDefault()
      return
    }
    trackDrag.begin(item)
    // Copy, not move: the row stays where it is; only the queue gains a track.
    event.dataTransfer.effectAllowed = 'copy'
    // The store carries the item for live previews; these keep the payload
    // valid and give other apps something readable if it ever leaves Viby.
    event.dataTransfer.setData(TRACK_DRAG_TYPE, item.id)
    event.dataTransfer.setData('text/plain', `${item.title} — ${item.subtitle}`)
    try {
      event.dataTransfer.setDragImage(dragGhost(), 18, 20)
    } catch {
      // Synthetic drags (tests) have no native drag to attach an image to.
    }
  }

  function dragEnd(): void {
    trackDrag.end()
  }

  function fmt(seconds?: number): string {
    if (!seconds) return ''
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  async function toggleFavorite(): Promise<void> {
    if (!canPlay) return
    try {
      await favorites.toggle(toTrack(item))
    } catch {
      // The heart simply stays where it was; the error is not worth a banner.
    }
  }

  async function toggleDownload(): Promise<void> {
    if (!canPlay) return
    if (downloadState === 'done') {
      if (window.confirm(`Remove the download for “${item.title}”?`)) {
        await downloads.removeTrack(item.id)
      }
      return
    }
    if (downloadState === 'downloading' || downloadState === 'queued' || downloadState === 'paused') {
      await downloads.cancel(item.id)
      return
    }
    if (downloadState === 'failed') {
      await downloads.retry(item.id)
      return
    }
    await downloads.addTrack(toTrack(item))
  }
</script>

<li
  class="row"
  class:active
  class:unavailable={blocked}
  class:focused
  class:dragging
  data-track-id={item.id}
  draggable={canPlay}
  ondragstart={dragStart}
  ondragend={dragEnd}
  onpointerenter={hoverStart}
  onpointerleave={hoverEnd}
>
  <div
    class="main"
    role="button"
    tabindex="0"
    aria-disabled={blocked}
    title={blocked ? 'Not downloaded — unavailable offline' : playable ? 'Play' : 'Open'}
    onclick={activate}
    onkeydown={(event) => {
      // The row contains real artist/album buttons; let them handle their own
      // Enter instead of playing the row underneath. Space is the global
      // play/pause key, so it is deliberately not handled here.
      if (event.target !== event.currentTarget) return
      if (event.key === 'Enter') {
        event.preventDefault()
        activate()
      }
    }}
  >
    {#if showIndex}
      <!-- Only indexed lists (albums, playlists, downloads) reserve a column.
           A row without numbers starts at its artwork instead of indenting
           past an empty slot. -->
      <span class="idx">
        {#if playing}
          <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
        {:else}
          <span class="tabular">{index !== undefined ? index + 1 : ''}</span>
        {/if}
      </span>
    {/if}

    {#if showArt}
      <span class="art" class:rounded>
        <Cover src={art} size={40} radius={rounded ? 20 : 6} alt={item.title} />
        {#if playing && !showIndex}
          <!-- No number column to hold the indicator, so it sits on the cover
               rather than shifting the row when playback starts. -->
          <span class="eq over" aria-hidden="true"><i></i><i></i><i></i></span>
        {/if}
      </span>
    {/if}

    <span class="text">
      {#if playable}
        <button
          type="button"
          class="title truncate"
          title={item.album ? `Open ${item.album}` : `Open ${item.title}`}
          onclick={(event) => {
            event.stopPropagation()
            openTrackFromItem(item)
          }}
        >
          {item.title}
        </button>
      {:else}
        <span class="title truncate">{item.title}</span>
      {/if}
      <span class="sub truncate">
        {#if item.kind !== 'song'}<span class="tag">{item.releaseType ?? item.kind}</span>{/if}
        <SubtitleParts parts={item.parts} fallback={item.subtitle} />
        {#if item.views}
          <span class="views">{item.parts?.length ? ' · ' : ''}{item.views}</span>
        {/if}
      </span>
    </span>

    <span class="dur tabular">{fmt(item.durationSec)}</span>
  </div>

  {#if meta}
    <span class="row-meta tabular">{meta}</span>
  {/if}

  {#if actionCount > 0}
    <!-- Hover actions live outside the row's width until it is hovered: the
         reserved gutter beside every duration was permanent dead space. The
         container grows from the right edge, so the buttons slide in while the
         duration steps aside. -->
    <span class="actions" style={`--actions-w: ${actionCount * 32}px`}>
      {#if canPlay && showFavorite}
        <button
          class="row-action fav"
          class:on={favorited}
          title={favorited ? 'Remove from favourites' : 'Add to favourites'}
          aria-label={favorited ? 'Remove from favourites' : 'Add to favourites'}
          onclick={(event) => {
            event.stopPropagation()
            void toggleFavorite()
          }}
        >
          <Icon name="heart" size={15} solid={favorited} />
        </button>
      {/if}

      {#if canPlay && showDownload}
        <button
          class="row-action dl"
          class:on={downloadState === 'done'}
          class:failed={downloadState === 'failed'}
          class:busy={downloadState === 'downloading' || downloadState === 'queued' || downloadState === 'paused'}
          title={downloadTitle}
          aria-label={downloadTitle}
          onclick={(event) => {
            event.stopPropagation()
            void toggleDownload()
          }}
        >
          {#if downloadState === 'downloading' || downloadState === 'queued' || downloadState === 'paused'}
            <span class="spin" aria-hidden="true"></span>
          {:else if downloadState === 'done'}
            <Icon name="check" size={15} />
          {:else}
            <Icon name="download" size={15} />
          {/if}
        </button>
      {/if}

      {#if canPlay}
        <button
          class="row-action"
          title="Add to playlist"
          aria-label="Add to playlist"
          onclick={(event) => {
            event.stopPropagation()
            playlistPicker.show(toTrack(item), event.currentTarget as HTMLElement)
          }}
        >
          <Icon name="plus" size={15} />
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
            <Icon name="queueAdd" size={15} />
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
    </span>
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

  /* The destination row after a song title opened its album: a short flash,
     not a second selection state. */
  .row.focused {
    animation: row-focus 2.8s var(--ease);
  }

  @keyframes row-focus {
    0%,
    24% {
      background: rgba(255, 255, 255, 0.16);
    }
    100% {
      background: transparent;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .row.focused {
      animation: none;
      background: var(--glass-active);
    }
  }

  .row.unavailable {
    opacity: 0.38;
  }

  /* The source row fades while its ghost is in the air, so the list shows what
     is being carried without removing the row. */
  .row.dragging {
    opacity: 0.4;
  }

  .row.unavailable:hover {
    background: transparent;
  }

  .row.unavailable .main {
    cursor: default;
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

  /* The cover and its now-playing overlay share one box, so the indicator can
     sit on the artwork without a layout of its own. */
  .art {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
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

  button.title {
    display: block;
    align-self: flex-start;
    max-width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font-family: inherit;
    text-align: left;
    transition: color var(--speed) var(--ease);
  }

  button.title:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .active .title {
    color: var(--text);
  }

  .sub {
    font-size: 12px;
    color: var(--text-faint);
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

  .row-meta {
    flex-shrink: 0;
    padding-left: 10px;
    color: var(--text-faint);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
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

  /* Zero width until the row is hovered: no permanent gutter beside the
     duration. The strip grows from the right edge, so its buttons slide in
     and the duration steps aside. min-width: 0 defeats a flex item's
     automatic min-content floor, which would keep the strip open. */
  .actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
    min-width: 0;
    width: 0;
    overflow: hidden;
    transition: width 170ms var(--ease);
  }

  .row:hover .actions,
  .row:focus-within .actions {
    width: var(--actions-w);
  }

  @media (prefers-reduced-motion: reduce) {
    .actions {
      transition: none;
    }
  }

  .row:hover .row-action,
  .row:focus-within .row-action,
  .row-action:focus-visible {
    opacity: 1;
  }

  .row-action:hover {
    color: var(--text);
    background: var(--glass-hover);
  }

  .row-action.dl.on {
    opacity: 1;
    color: var(--text);
  }

  .row-action.fav.on {
    opacity: 1;
    color: var(--text);
  }

  .row-action.dl.failed {
    opacity: 1;
    color: var(--danger);
  }

  .row-action.dl.busy {
    opacity: 1;
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

  /* Three bars that dance while this row is the playing one. */
  .eq {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 11px;
  }

  .eq.over {
    position: absolute;
    inset: 0;
    height: auto;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: rgba(8, 8, 11, 0.58);
  }

  .art.rounded .eq.over {
    border-radius: 50%;
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
