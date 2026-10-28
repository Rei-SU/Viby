<script lang="ts">
  import { player } from '../lib/player.svelte'
  import { nav } from '../lib/nav.svelte'
  import ArtistLinks from './ArtistLinks.svelte'
  import { favorites } from '../lib/favorites.svelte'
  import { sidePanel } from '../lib/side-panel.svelte'
  import { isTrackDrag, trackDrag } from '../lib/track-drag.svelte'
  import { toast } from '../lib/toast.svelte'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'

  let dragging = $state(false)
  let dragValue = $state(0)
  /** A song is hovering the queue button, ready to be appended. */
  let queueOver = $state(false)

  $effect(() => {
    if (!trackDrag.active) queueOver = false
  })

  function queueDragOver(event: DragEvent): void {
    if (!isTrackDrag(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    queueOver = true
  }

  function onQueueDrop(event: DragEvent): void {
    if (!isTrackDrag(event)) return
    event.preventDefault()
    queueOver = false
    const item = trackDrag.item
    if (!item) return
    player.enqueue(item)
    toast.show(`Added ${item.title} to queue`)
  }

  const shownPosition = $derived(dragging ? dragValue : player.position)
  const track = $derived(player.current)
  const fav = $derived(track ? favorites.has(track.id) : false)
  // Resolving a new stream and recovering a dead one are the same wait to the user.
  const loading = $derived(player.busy || player.reconnecting)

  const progress = $derived(
    player.duration > 0 ? Math.min(100, (shownPosition / player.duration) * 100) : 0
  )
  const volumeLevel = $derived(player.muted ? 0 : Math.round(player.volume * 100))

  // The repeat button cycles, so its label names the click rather than the
  // state; the icon carries the state (dim / loop / loop with a 1).
  const repeatLabel = $derived(
    player.repeat === 'off'
      ? 'Enable repeat'
      : player.repeat === 'all'
        ? 'Enable repeat one'
        : 'Disable repeat'
  )

  // Wheel over the volume control. A mouse notch is 100px on Windows while a
  // trackpad sends a stream of 1–20px deltas, so pixels are accumulated and
  // spent in whole percent: 20px per point, i.e. 5% per notch either way.
  const WHEEL_PX_PER_PERCENT = 20
  let wheelPx = 0
  let volumeHint = $state(false)
  let volumeHintTimer: ReturnType<typeof setTimeout> | null = null

  function onVolumeWheel(event: WheelEvent): void {
    // Chromium reports pixels (0); lines (1) and pages (2) only occur
    // elsewhere, but the maths should not silently go 16x wrong if they do.
    const px =
      event.deltaMode === 1
        ? event.deltaY * 16
        : event.deltaMode === 2
          ? event.deltaY * 100
          : event.deltaY
    if (!px) return
    event.preventDefault()
    wheelPx += px
    const steps = Math.trunc(wheelPx / WHEEL_PX_PER_PERCENT)
    if (!steps) return
    wheelPx -= steps * WHEEL_PX_PER_PERCENT
    // Muted is already silent: lowering the hidden volume would change what
    // plays after unmuting, which is not what the gesture looks like it does.
    if (player.muted && steps > 0) return
    // deltaY is positive when scrolling down, which lowers the volume. Round
    // to the slider's own 1% step so repeated steps cannot drift the float.
    player.setVolume(Math.round((player.volume - steps / 100) * 100) / 100)
    volumeHint = true
    if (volumeHintTimer) clearTimeout(volumeHintTimer)
    volumeHintTimer = setTimeout(() => (volumeHint = false), 800)
  }

  /** Drop a half-finished step so it cannot combine with the next gesture. */
  function resetVolumeWheel(): void {
    wheelPx = 0
  }

  // What the stream actually is — not what the setting says it should be.
  const codec = $derived.by(() => {
    const ext = player.stream?.ext
    switch (ext) {
      case 'm4a':
      case 'mp4':
        return 'AAC'
      case 'webm':
      case 'opus':
      case 'ogg':
        return 'OPUS'
      case 'mp3':
        return 'MP3'
      default:
        return ext ? ext.toUpperCase() : null
    }
  })

  const qualityText = $derived(
    codec ? `${codec}${player.stream?.bitrateKbps ? ` ${player.stream.bitrateKbps}k` : ''}` : null
  )

  const qualityTitle = $derived.by(() => {
    const stream = player.stream
    if (!stream) return ''
    const parts = [codec ?? stream.ext.toUpperCase()]
    if (stream.bitrateKbps) parts.push(`${stream.bitrateKbps} kbps`)
    parts.push(
      stream.source === 'download'
        ? 'downloaded'
        : stream.kind === 'file'
          ? 'cached on disk'
          : 'streaming'
    )
    return parts.join(' · ')
  })

  $effect(() => {
    void favorites.load()
  })

  function onSeekInput(event: Event): void {
    dragging = true
    dragValue = Number((event.currentTarget as HTMLInputElement).value)
  }

  function onSeekCommit(): void {
    player.seek(dragValue)
    dragging = false
  }

  const PREVIEW_EDGE = 22
  let seekEl = $state<HTMLDivElement | undefined>(undefined)
  let preview = $state<{ percent: number; seconds: number } | null>(null)
  let previewFrame = 0
  let previewX = 0

  function schedulePreview(event: PointerEvent): void {
    previewX = event.clientX
    if (previewFrame) return
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0
      if (!seekEl || !track || player.duration <= 0) return
      const rect = seekEl.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (previewX - rect.left) / rect.width))
      preview = { percent: ratio * 100, seconds: Math.round(ratio * player.duration) }
    })
  }

  function clearPreview(): void {
    if (previewFrame) cancelAnimationFrame(previewFrame)
    previewFrame = 0
    preview = null
  }

  $effect(() => {
    player.current?.id
    player.duration
    clearPreview()
  })

  function fmt(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
    const total = Math.floor(seconds)
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  async function toggleFav(): Promise<void> {
    if (!track) return
    try {
      await favorites.toggle(track)
    } catch (err) {
      console.error('[favorites] toggle failed', err)
    }
  }
</script>

<footer class="dock glass">
  <div class="meta">
    <Cover src={track?.thumbnail} size={50} radius={10} alt={track?.title ?? ''} />
    <div class="meta-text">
      <button class="title truncate" title="Open song page" onclick={() => track && nav.openTrack(track)}>
        {track?.title ?? 'Nothing playing'}
      </button>
      {#if track}
        <span class="artist truncate">
          <ArtistLinks parts={track.artistParts} name={track.artist} id={track.artistId} />
        </span>
      {:else}
        <span class="artist">—</span>
      {/if}
    </div>
    {#if track}
      <button
        class="icon fav"
        class:on={fav}
        title={fav ? 'Remove from favourites' : 'Add to favourites'}
        aria-label="Favourite"
        onclick={toggleFav}
      >
        <Icon name="heart" size={17} solid={fav} />
      </button>
    {/if}
  </div>

  <div class="controls">
    <div class="buttons">
      <button
        class="icon"
        class:on={player.shuffle}
        title="Shuffle"
        aria-label="Shuffle"
        onclick={() => player.toggleShuffle()}
      >
        <Icon name="shuffle" size={16} />
      </button>

      <button class="icon" title="Previous" aria-label="Previous" onclick={() => player.previous()}>
        <Icon name="prev" size={17} />
      </button>

      <button
        class="play"
        class:loading={loading}
        title={loading ? 'Loading…' : player.playing ? 'Pause' : 'Play'}
        aria-label={loading ? 'Loading' : player.playing ? 'Pause' : 'Play'}
        onclick={() => {
          if (!loading) player.toggle()
        }}
      >
        {#if loading}
          <span class="spinner"></span>
        {:else}
          <Icon name={player.playing ? 'pause' : 'play'} size={17} />
        {/if}
      </button>

      <button class="icon" title="Next" aria-label="Next" onclick={() => player.next()}>
        <Icon name="next" size={17} />
      </button>

      <button
        class="icon"
        class:on={player.repeat !== 'off'}
        title={repeatLabel}
        aria-label={repeatLabel}
        onclick={() => player.cycleRepeat()}
      >
        <Icon name={player.repeat === 'one' ? 'repeatOne' : 'repeat'} size={16} />
      </button>
    </div>

    <div class="scrub">
      <span class="time tabular">{fmt(shownPosition)}</span>
      <div
        class="seek"
        bind:this={seekEl}
        role="presentation"
        onpointerenter={schedulePreview}
        onpointermove={schedulePreview}
        onpointerleave={clearPreview}
      >
        {#if preview}
          <span
            class="seek-preview tabular"
            style="left: clamp({PREVIEW_EDGE}px, {preview.percent}%, calc(100% - {PREVIEW_EDGE}px))"
            aria-hidden="true"
          >
            {fmt(preview.seconds)}
          </span>
        {/if}
        <input
          type="range"
          min="0"
          max={Math.max(player.duration, 1)}
          step="1"
          value={shownPosition}
          style="--progress: {progress}%"
          disabled={!track}
          aria-label="Seek"
          aria-valuetext={track ? fmt(shownPosition) : undefined}
          oninput={onSeekInput}
          onchange={onSeekCommit}
        />
      </div>
      <span class="time tabular">{fmt(player.duration)}</span>
    </div>
  </div>

  <div class="right">
    {#if qualityText}
      <span class="quality" title={qualityTitle}>{qualityText}</span>
    {/if}
    <button
      class="icon"
      class:on={sidePanel.mode === 'queue'}
      class:drop-ready={trackDrag.active}
      class:queue-over={queueOver}
      title={queueOver ? 'Add to queue' : 'Queue'}
      aria-label="Queue"
      onclick={() => sidePanel.toggle('queue')}
      ondragover={queueDragOver}
      ondragleave={() => (queueOver = false)}
      ondrop={onQueueDrop}
    >
      <Icon name="list" size={16} />
    </button>
    <button
      class="icon"
      class:on={sidePanel.mode === 'lyrics'}
      title="Lyrics"
      aria-label="Lyrics"
      disabled={!track}
      onclick={() => sidePanel.toggle('lyrics')}
    >
      <Icon name="lyrics" size={16} />
    </button>
    <button
      class="icon"
      title={player.muted ? 'Unmute' : 'Mute'}
      aria-label={player.muted ? 'Unmute' : 'Mute'}
      onclick={() => player.toggleMute()}
    >
      <Icon name={player.muted || player.volume === 0 ? 'mute' : 'volume'} size={16} />
    </button>
    <div
      class="volume-wrap"
      role="presentation"
      onwheel={onVolumeWheel}
      onpointerleave={resetVolumeWheel}
    >
      <input
        type="range"
        class="volume"
        min="0"
        max="1"
        step="0.01"
        value={player.muted ? 0 : player.volume}
        style="--progress: {volumeLevel}%"
        aria-label="Volume"
        oninput={(e) => player.setVolume(Number((e.currentTarget as HTMLInputElement).value))}
      />
      <span class="volume-hint" class:show={volumeHint} aria-hidden="true">{volumeLevel}%</span>
    </div>
  </div>
</footer>

<style>
  .dock {
    grid-column: 1 / -1;
    grid-row: 3;
    border-radius: 0;
    border-top: 1px solid var(--stroke);
    box-shadow: none;
    display: grid;
    grid-template-columns: minmax(210px, 1fr) minmax(380px, 1.5fr) minmax(190px, 1fr);
    align-items: center;
    gap: 22px;
    padding: 0 22px;
    min-width: 0;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .meta-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 1px;
  }

  .title {
    align-self: flex-start;
    font-size: 13.5px;
    font-weight: 550;
    text-align: left;
    max-width: 100%;
    color: var(--text);
  }

  .title:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .artist {
    display: block;
    min-width: 0;
    font-size: 12px;
    color: var(--text-dim);
    text-align: left;
    max-width: 100%;
  }

  .icon {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    color: var(--text-dim);
    transition:
      color var(--speed) var(--ease),
      background var(--speed) var(--ease);
  }

  .icon:hover {
    color: var(--text);
    background: var(--glass-hover);
  }

  .icon.on {
    color: var(--accent);
  }

  /* While a song is in the air, the queue button advertises itself as a target;
     hovering it with the drag fills it in. */
  .icon.drop-ready {
    color: var(--text);
    background: var(--glass-hover);
    outline: 1px dashed var(--stroke-strong);
    outline-offset: -1px;
  }

  .icon.queue-over {
    background: var(--glass-active);
    outline-style: solid;
    outline-color: var(--text);
  }

  .fav.on {
    color: var(--text);
  }

  .controls {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 9px;
    padding: 8px 0;
    min-width: 0;
  }

  .buttons {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .play {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    margin: 0 6px;
    color: #08080b;
    background: var(--text);
    transition: transform var(--speed) var(--ease);
  }

  .play:hover {
    transform: scale(1.04);
  }

  .play.loading {
    background: var(--glass-active);
    color: var(--text);
    cursor: default;
    transform: none;
  }

  .spinner {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.22);
    border-top-color: var(--text);
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .scrub {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
  }

  .seek {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    height: 18px;
  }

  .seek input {
    width: 100%;
    min-width: 0;
  }

  .seek-preview {
    position: absolute;
    bottom: calc(100% + 5px);
    z-index: 4;
    padding: 4px 7px;
    border: 1px solid var(--stroke-strong);
    border-radius: 7px;
    background: #1b1b22;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.38);
    color: var(--text);
    font-size: 11px;
    font-weight: 550;
    line-height: 1.2;
    white-space: nowrap;
    pointer-events: none;
    transform: translateX(-50%);
    animation: seek-preview-in 120ms var(--ease);
  }

  .seek-preview::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    width: 6px;
    height: 6px;
    border-right: 1px solid var(--stroke-strong);
    border-bottom: 1px solid var(--stroke-strong);
    background: inherit;
    transform: translate(-50%, -3px) rotate(45deg);
  }

  @keyframes seek-preview-in {
    from {
      opacity: 0;
      transform: translate(-50%, 3px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .seek-preview {
      animation: none;
    }
  }

  .time {
    font-size: 11px;
    color: var(--text-faint);
    width: 34px;
    text-align: center;
  }

  .right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
  }

  .volume-wrap {
    position: relative;
    display: flex;
    align-items: center;
    /* The track is only 4px tall; this padding is the hover target that makes
       the wheel usable. */
    padding: 8px 0;
  }

  /* Hovering the band should reveal the thumb, as hovering the track does. */
  .volume-wrap:hover .volume::-webkit-slider-thumb {
    opacity: 1;
  }

  .volume {
    width: 92px;
  }

  .volume-hint {
    position: absolute;
    bottom: calc(100% + 5px);
    left: 50%;
    padding: 4px 7px;
    border: 1px solid var(--stroke-strong);
    border-radius: 7px;
    background: #1b1b22;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.38);
    color: var(--text);
    font-size: 11px;
    font-weight: 550;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transform: translateX(-50%);
    transition: opacity 120ms var(--ease);
  }

  .volume-hint::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    width: 6px;
    height: 6px;
    border-right: 1px solid var(--stroke-strong);
    border-bottom: 1px solid var(--stroke-strong);
    background: inherit;
    transform: translate(-50%, -3px) rotate(45deg);
  }

  .volume-hint.show {
    opacity: 1;
  }

  .quality {
    font-size: 9.5px;
    font-weight: 550;
    letter-spacing: 0.07em;
    color: var(--text-dim);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--stroke);
    padding: 2px 8px;
    border-radius: 999px;
    margin-right: 2px;
    font-variant-numeric: tabular-nums;
    cursor: default;
    transition: color var(--speed) var(--ease);
  }

  .quality:hover {
    color: var(--text);
  }
</style>
