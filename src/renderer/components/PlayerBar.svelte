<script lang="ts">
  import { player } from '../lib/player.svelte'
  import { api } from '../lib/api'
  import { nav } from '../lib/nav.svelte'
  import ArtistLinks from './ArtistLinks.svelte'
  import { plainTrack } from '../lib/track'
  import { lyrics } from '../lib/lyrics.svelte'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'

  let dragging = $state(false)
  let dragValue = $state(0)
  let fav = $state(false)
  let favRequest = 0

  const shownPosition = $derived(dragging ? dragValue : player.position)
  const track = $derived(player.current)
  // Resolving a new stream and recovering a dead one are the same wait to the user.
  const loading = $derived(player.busy || player.reconnecting)

  const progress = $derived(
    player.duration > 0 ? Math.min(100, (shownPosition / player.duration) * 100) : 0
  )
  const volumeLevel = $derived(player.muted ? 0 : Math.round(player.volume * 100))

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
    const id = player.current?.id
    if (!id) {
      fav = false
      return
    }
    const request = ++favRequest
    void api.favorites
      .list()
      .then((list) => {
        // A slower response for the previous track must not overwrite the
        // heart for the one now in the player.
        if (request === favRequest && player.current?.id === id) {
          fav = list.some((t) => t.id === id)
        }
      })
      .catch(() => undefined)
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
    const snapshot = plainTrack(track)
    const id = snapshot.id
    const request = ++favRequest
    try {
      const res = await api.favorites.toggle(snapshot)
      if (request === favRequest && player.current?.id === id) fav = res.favorited
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
        title={`Repeat: ${player.repeat}`}
        aria-label="Repeat"
        onclick={() => player.cycleRepeat()}
      >
        <Icon name="repeat" size={16} />
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
      class:on={lyrics.open}
      title="Lyrics"
      aria-label="Lyrics"
      disabled={!track}
      onclick={() => void lyrics.toggle(track)}
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

  .volume {
    width: 92px;
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
