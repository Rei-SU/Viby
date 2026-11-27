<script lang="ts">
  import { player } from '../lib/player.svelte'
  import { nav } from '../lib/nav.svelte'
  import ArtistLinks from './ArtistLinks.svelte'
  import { favorites } from '../lib/favorites.svelte'
  import { contextItem } from '../lib/context-item'
  import { trackToItem } from '../lib/track'
  import { sidePanel } from '../lib/side-panel.svelte'
  import { isTrackDrag, trackDrag } from '../lib/track-drag.svelte'
  import { toast } from '../lib/toast.svelte'
  import { account } from '../lib/account.svelte'
  import { connect } from '../lib/connect.svelte'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'
  import DevicesPanel from './DevicesPanel.svelte'
  import { codecLabel, qualityLabel } from '../lib/quality'
  import { formatDuration as fmt } from '../lib/format'

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

  // When another device holds the latest claim this bar mirrors that session,
  // like Spotify's controller window: its track, its moving clock, its controls.
  const remote = $derived(connect.remote)
  const remoteStatus = $derived(remote ? `${remote.playing ? 'Playing' : 'Paused'} on ${remote.name}` : '')
  let devicesTrigger = $state<HTMLButtonElement>()
  let remoteTrigger = $state<HTMLButtonElement>()
  const remoteTrack = $derived(connect.remote ? connect.trackOf(connect.remote) : null)
  const track = $derived(remoteTrack ?? player.current)
  const fav = $derived(track ? favorites.has(track.id) : false)
  // Resolving a new stream and recovering a dead one are the same wait to the user.
  const loading = $derived(remote ? false : player.busy || player.reconnecting)
  const playing = $derived(remote ? remote.playing : player.playing)
  const duration = $derived(remote?.track?.durationSec ?? player.duration)

  // A remote position is extrapolated from its last published sample; the
  // clock ticks at 1 Hz only while a remote session is on screen.
  let clock = $state(Date.now())
  $effect(() => {
    if (!remote) return
    const timer = setInterval(() => (clock = Date.now()), 1_000)
    return () => clearInterval(timer)
  })
  const remotePosition = $derived.by(() => {
    if (!remote) return 0
    // `clock` keeps this reactive once a second; the value itself is corrected
    // for the other machine's clock offset inside the store.
    clock
    return connect.devicePosition(remote)
  })
  const shownPosition = $derived(remote ? remotePosition : dragging ? dragValue : player.position)

  const progress = $derived(duration > 0 ? Math.min(100, (shownPosition / duration) * 100) : 0)
  const volumeLevel = $derived(
    Math.round((remote ? (remote.muted ? 0 : remote.volume) : player.muted ? 0 : player.volume) * 100)
  )

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
    if (!remote && player.muted && steps > 0) return
    // deltaY is positive when scrolling down, which lowers the volume. Round
    // to the slider's own 1% step so repeated steps cannot drift the float.
    const base = remote ? (remote.muted ? 0 : remote.volume) : player.volume
    const next = Math.round((base - steps / 100) * 100) / 100
    if (remote) void connect.remoteVolume(remote, next)
    else player.setVolume(next)
    volumeHint = true
    if (volumeHintTimer) clearTimeout(volumeHintTimer)
    volumeHintTimer = setTimeout(() => (volumeHint = false), 800)
  }

  /** Drop a half-finished step so it cannot combine with the next gesture. */
  function resetVolumeWheel(): void {
    wheelPx = 0
  }

  // What the stream actually is — not what the setting says it should be.
  const codec = $derived(codecLabel(player.stream?.ext))

  const qualityText = $derived(remote ? '' : qualityLabel(player.stream))

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
    dragging = false
    if (remote?.track) {
      void connect.remoteSeek(remote, remote.track.id, dragValue)
      return
    }
    player.seek(dragValue)
  }

  /** The bar's transport follows whatever it is showing. */
  function togglePlay(): void {
    if (remote) {
      void connect.remotePlayPause(remote)
      return
    }
    if (!loading) player.toggle()
  }

  function skipPrevious(): void {
    if (remote) void connect.remotePrevious(remote)
    else player.previous()
  }

  function skipNext(): void {
    if (remote) void connect.remoteNext(remote)
    else player.next()
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
      if (!seekEl || !track || duration <= 0) return
      const rect = seekEl.getBoundingClientRect()
      const ratio = Math.min(1, Math.max(0, (previewX - rect.left) / rect.width))
      preview = { percent: ratio * 100, seconds: Math.round(ratio * duration) }
    })
  }

  function clearPreview(): void {
    if (previewFrame) cancelAnimationFrame(previewFrame)
    previewFrame = 0
    preview = null
  }

  $effect(() => {
    track?.id
    duration
    clearPreview()
  })

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
  <span class="sr-only" role="status">{remoteStatus}</span>
  {#if remote}
    <button
      class="remote-strip"
      class:live={remote.playing}
      bind:this={remoteTrigger}
      aria-expanded={connect.open}
      title={remoteStatus}
      onclick={() => connect.toggle()}
    >
      <span class="remote-mark" aria-hidden="true">
        {#if remote.playing}
          <span class="signal"><i></i><i></i><i></i></span>
        {:else}
          <Icon name="pause" size={13} />
        {/if}
      </span>
      <span class="remote-label truncate">
        {remote.playing ? 'Playing' : 'Paused'} on <strong>{remote.name}</strong>
      </span>
      <span class="remote-action">
        <Icon name="devices" size={15} />
        Devices
        <span class="remote-chevron" class:expanded={connect.open}><Icon name="back" size={12} /></span>
      </span>
    </button>
  {/if}

  <div class="dock-body">
    <div
      class="meta"
      use:contextItem={track
        ? {
            item: trackToItem(track),
            play: () => (remote ? void connect.remotePlayPause(remote) : player.toggle())
          }
        : null}
    >
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
          class="icon shuffle"
          class:on={player.shuffle && !remote}
          title={remote ? 'Shuffle — this device only' : 'Shuffle'}
          aria-label="Shuffle"
          aria-pressed={player.shuffle && !remote}
          disabled={!!remote}
          onclick={() => player.toggleShuffle()}
        >
          <Icon name="shuffle" size={16} />
        </button>

        <button class="icon" title="Previous" aria-label="Previous" onclick={skipPrevious}>
          <Icon name="prev" size={17} />
        </button>

        <button
          class="play"
          class:loading={loading}
          title={loading ? 'Loading…' : playing ? 'Pause' : 'Play'}
          aria-label={loading ? 'Loading' : playing ? 'Pause' : 'Play'}
          onclick={togglePlay}
        >
          {#if loading}
            <span class="spinner"></span>
          {:else}
            <Icon name={playing ? 'pause' : 'play'} size={17} />
          {/if}
        </button>

        <button class="icon" title="Next" aria-label="Next" onclick={skipNext}>
          <Icon name="next" size={17} />
        </button>

        <button
          class="icon repeat"
          class:on={player.repeat !== 'off' && !remote}
          title={remote ? 'Repeat — this device only' : repeatLabel}
          aria-label={repeatLabel}
          aria-pressed={player.repeat !== 'off' && !remote}
          disabled={!!remote}
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
            max={Math.max(duration, 1)}
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
        <span class="time tabular">{fmt(duration)}</span>
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
      {#if account.signedIn && !remote}
        <button
          class="icon"
          class:on={connect.open}
          class:remote={!!connect.remotePlaying}
          title={connect.remotePlaying ? `Playing on ${connect.remotePlaying.name}` : 'Devices'}
          aria-label="Devices"
          aria-expanded={connect.open}
          bind:this={devicesTrigger}
          onclick={() => connect.toggle()}
        >
          <Icon name="devices" size={16} />
        </button>
      {/if}
      {#if !remote}
        <button
          class="icon"
          title={player.muted ? 'Unmute' : 'Mute'}
          aria-label={player.muted ? 'Unmute' : 'Mute'}
          onclick={() => player.toggleMute()}
        >
          <Icon name={player.muted || player.volume === 0 ? 'mute' : 'volume'} size={16} />
        </button>
      {/if}
      <div
        class="volume-wrap"
        class:remote
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
          value={remote ? (remote.muted ? 0 : remote.volume) : player.muted ? 0 : player.volume}
          style="--progress: {volumeLevel}%"
          aria-label={remote ? `Volume on ${remote.name}` : 'Volume'}
          oninput={(e) => {
            if (!remote) player.setVolume(Number((e.currentTarget as HTMLInputElement).value))
          }}
          onchange={(e) => {
            if (remote) void connect.remoteVolume(remote, Number((e.currentTarget as HTMLInputElement).value))
          }}
        />
        <span class="volume-hint" class:show={volumeHint} aria-hidden="true">{volumeLevel}%</span>
      </div>
    </div>
  </div>
  {#if account.signedIn}
    <DevicesPanel trigger={remote ? remoteTrigger : devicesTrigger} />
  {/if}
</footer>

<style>
  .dock {
    grid-column: 1 / -1;
    grid-row: 3;
    border-radius: 0;
    border-top: 1px solid var(--stroke);
    box-shadow: none;
    min-width: 0;
  }

  .dock-body {
    display: grid;
    grid-template-columns: minmax(210px, 1fr) minmax(380px, 1.5fr) minmax(190px, 1fr);
    align-items: center;
    gap: 22px;
    padding: 0 22px;
    min-height: calc(var(--player-h) - 2px);
    min-width: 0;
  }

  .remote-strip {
    --remote-accent: var(--text-dim);
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 36px;
    width: 100%;
    padding: 0 22px;
    border-bottom: 1px solid color-mix(in srgb, var(--remote-accent) 26%, transparent);
    background: linear-gradient(90deg, color-mix(in srgb, var(--remote-accent) 17%, transparent),
      color-mix(in srgb, var(--remote-accent) 5%, transparent));
    color: var(--text);
    text-align: left;
    font-size: 12px;
  }

  .remote-strip.live {
    --remote-accent: var(--accent-green);
  }

  .remote-strip:hover,
  .remote-strip[aria-expanded='true'] {
    background-color: color-mix(in srgb, var(--remote-accent) 7%, transparent);
  }

  .remote-strip:focus-visible {
    outline-offset: -3px;
  }

  .remote-mark {
    display: grid;
    place-items: center;
    flex: none;
    width: 23px;
    height: 23px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--remote-accent) 16%, transparent);
    color: var(--remote-accent);
  }

  .signal {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .signal i {
    width: 2px;
    height: 7px;
    border-radius: 2px;
    background: currentColor;
  }

  .signal i:nth-child(2) {
    height: 13px;
  }

  .signal i:nth-child(3) {
    height: 9px;
  }

  .remote-label {
    min-width: 0;
  }

  .remote-label strong {
    font-weight: 700;
  }

  .remote-action {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    margin-left: auto;
    color: var(--remote-accent);
    font-weight: 600;
  }

  .remote-chevron {
    display: grid;
    place-items: center;
    transform: rotate(90deg);
  }

  .remote-chevron.expanded {
    transform: rotate(-90deg);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
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
    position: relative;
    flex: 0 0 auto;
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

  .icon.remote::after {
    content: '';
    position: absolute;
    top: 5px;
    right: 5px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
  }

  .icon:hover {
    color: var(--text);
    background: var(--glass-hover);
  }

  .icon:disabled {
    color: var(--text-faint);
    background: none;
    cursor: default;
    opacity: 0.55;
  }

  .icon.on {
    color: var(--accent);
  }

  /* Shuffle and repeat are the only transport toggles whose state is easy to
     miss; give their active state the Spotify-style green accent. */
  .icon.shuffle.on,
  .icon.repeat.on {
    color: var(--accent-green);
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
    position: relative;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    min-width: 0;
  }

  .volume-wrap {
    position: relative;
    display: flex;
    align-items: center;
    flex: 0 1 92px;
    min-width: 0;
    /* The track is only 4px tall; this padding is the hover target that makes
       the wheel usable. */
    padding: 8px 0;
  }

  /* Hovering the band should reveal the thumb, as hovering the track does. */
  .volume-wrap:hover .volume::-webkit-slider-thumb {
    opacity: 1;
  }

  .volume {
    width: 100%;
    min-width: 48px;
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
    flex: 0 0 auto;
    white-space: nowrap;
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

  /* Narrow windows: the badge and transport stay intact and the slider gives
     way first. Below this the slider is hidden (mute remains) rather than
     letting any control overlap its neighbour or clip. */
  @media (max-width: 1080px) {
    .dock-body {
      grid-template-columns: minmax(180px, 1fr) minmax(300px, 1.5fr) minmax(0, auto);
      gap: 14px;
      padding: 0 16px;
    }

    .remote-strip {
      padding-inline: 16px;
    }

    .right {
      gap: 4px;
    }

    .volume-wrap {
      display: none;
    }
  }
</style>
