<script lang="ts">
  import type { ConnectDevice } from '@shared/connect'
  import { connect } from '../lib/connect.svelte'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'

  let { trigger }: { trigger: HTMLButtonElement | undefined } = $props()
  let panel = $state<HTMLElement>()
  const active = $derived(connect.remote)
  const others = $derived(connect.others.filter((device) => device.id !== active?.id))
  const localName = $derived(connect.self?.name || connect.name)

  /**
   * The dock is a glass surface, which makes it a backdrop root: a panel inside
   * it can only blur the dock, not the page. Move the panel to <body> (as the
   * search dropdown and account sheet do) and pin it to the trigger in viewport
   * coordinates, so all three share one blur.
   */
  function portal(node: HTMLElement): { destroy: () => void } {
    document.body.appendChild(node)
    node.focus({ preventScroll: true })
    return { destroy: () => node.remove() }
  }

  $effect(() => {
    const anchor = trigger
    const node = panel
    if (!anchor || !node) return
    const place = (): void => {
      const rect = anchor.getBoundingClientRect()
      node.style.setProperty('--devices-right', `${Math.max(16, window.innerWidth - rect.right)}px`)
      node.style.bottom = `${Math.max(12, window.innerHeight - rect.top + 10)}px`
      node.style.maxHeight = `${Math.max(0, rect.top - 26)}px`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  })

  function onWindowClick(event: MouseEvent): void {
    if (!connect.open) return
    const target = event.target as Element | null
    if (!target) return
    if (panel?.contains(target)) return
    if (trigger?.contains(target)) return
    connect.close()
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && connect.open) close()
  }

  function close(): void {
    connect.close()
    trigger?.focus()
  }

  function volumePercent(device: ConnectDevice): number {
    return Math.round((device.muted ? 0 : device.volume) * 100)
  }

  function stateText(device: ConnectDevice): string {
    if (device.playing) return 'Playing'
    return device.track ? 'Paused' : 'Idle'
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKeydown} />

{#snippet handoff(device: ConnectDevice, primary = false)}
  <button
    class="handoff"
    class:primary
    disabled={connect.busyId !== ''}
    aria-label={connect.busyId === device.id ? 'Transferring playback' : `Play here from ${device.name}`}
    onclick={() => void connect.playHere(device)}
  >
    {connect.busyId === device.id ? 'Transferring…' : 'Play here'}
  </button>
{/snippet}

{#snippet controls(device: ConnectDevice)}
  {@const volume = volumePercent(device)}
  <div class="controls">
    {#if device.track}
      <div class="transport">
        <button
          aria-label="Previous on {device.name}"
          title="Previous"
          onclick={() => void connect.remotePrevious(device)}
        >
          <Icon name="prev" size={14} />
        </button>
        <button
          class="play"
          aria-label={device.playing ? `Pause ${device.name}` : `Play on ${device.name}`}
          title={device.playing ? 'Pause' : 'Play'}
          onclick={() => void connect.remotePlayPause(device)}
        >
          <Icon name={device.playing ? 'pause' : 'play'} size={15} />
        </button>
        <button
          aria-label="Next on {device.name}"
          title="Next"
          onclick={() => void connect.remoteNext(device)}
        >
          <Icon name="next" size={14} />
        </button>
      </div>
    {/if}
    <div class="volume">
      <Icon name={volume === 0 ? 'mute' : 'volume'} size={14} />
      <input
        type="range"
        min="0"
        max="100"
        value={volume}
        style="--progress: {volume}%"
        aria-label="Volume on {device.name}"
        onchange={(event) =>
          void connect.remoteVolume(device, Number(event.currentTarget.value) / 100)}
      />
    </div>
  </div>
{/snippet}

{#if connect.open}
  <section bind:this={panel} class="panel popover-surface" aria-labelledby="devices-title" tabindex="-1" use:portal>
    <header>
      <div class="heading">
        <span class="heading-icon"><Icon name="devices" size={19} /></span>
        <h2 id="devices-title">Devices</h2>
      </div>
      <button class="close" type="button" aria-label="Close devices" onclick={close}>
        <Icon name="close" size={15} />
      </button>
    </header>

    <div class="content">
      {#if !connect.available}
        <p class="empty" role="status">Connecting to your devices…</p>
      {:else}
        {#if active?.track}
          <div class="active-device" class:playing={active.playing}>
            <div class="active-heading">
              <span class="status-dot" aria-hidden="true"></span>
              {active.playing ? 'Playing on' : 'Paused on'}
              <strong class="truncate" title={active.name}>{active.name}</strong>
            </div>
            <div class="now-playing">
              <Cover src={active.track.thumbnail} size={42} radius={7} />
              <div class="device-copy">
                <span class="song truncate" title={active.track.title}>{active.track.title}</span>
                {#if active.track.artist}
                  <span class="secondary truncate" title={active.track.artist}>{active.track.artist}</span>
                {/if}
              </div>
            </div>
            {@render controls(active)}
          </div>
        {/if}

        <div class="device-row local">
          <div class="device-identity">
            <span class="device-icon"><Icon name="computer" size={18} /></span>
            <div class="device-copy">
              <span class="name truncate">This device</span>
              {#if localName}<span class="secondary truncate" title={localName}>{localName}</span>{/if}
            </div>
          </div>
          {#if active}{@render handoff(active, true)}{/if}
        </div>

        {#if others.length}
          <div class="other-devices">
            <h3>Other devices</h3>
            <div class="device-list">
              {#each others as device (device.id)}
                <div class="device-row other" class:has-track={!!device.track}>
                  <div class="device-identity">
                    <span class="device-icon"><Icon name="computer" size={18} /></span>
                    <div class="device-copy">
                      <span class="name truncate" title={device.name}>{device.name}</span>
                      <span class="secondary truncate">
                        {device.track ? `${stateText(device)} · ${device.track.title}` : device.platform}
                      </span>
                    </div>
                  </div>
                  {#if device.track}{@render handoff(device)}{/if}
                  {@render controls(device)}
                </div>
              {/each}
            </div>
          </div>
        {:else if !active}
          <p class="empty">No other devices are online.</p>
        {/if}
      {/if}
    </div>
  </section>
{/if}

<style>
  .panel {
    position: fixed;
    right: var(--devices-right, 16px);
    bottom: 16px;
    z-index: 60;
    display: flex;
    flex-direction: column;
    width: min(374px, calc(100vw - var(--devices-right, 16px) - 16px));
    max-height: calc(100dvh - 32px);
    overflow: hidden;
    -webkit-app-region: no-drag;
    animation: devices-in 160ms var(--ease);
  }

  .panel:focus {
    outline: none;
  }

  @keyframes devices-in {
    from {
      opacity: 0;
      transform: translateY(5px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .panel {
      animation: none;
    }
  }

  header,
  .heading,
  .device-identity,
  .now-playing {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  header {
    justify-content: space-between;
    flex-shrink: 0;
    padding: 13px 14px;
    border-bottom: 1px solid var(--stroke);
  }

  h2,
  h3,
  .empty {
    margin: 0;
  }

  h2 {
    font-size: 15px;
    font-weight: 650;
  }

  .heading-icon,
  .device-icon,
  .close {
    display: grid;
    place-items: center;
    flex: none;
  }

  .heading-icon {
    width: 31px;
    height: 31px;
    border: 1px solid var(--stroke-strong);
    border-radius: 9px;
    background: var(--glass-hover);
  }

  .close {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    color: var(--text-dim);
  }

  .close:hover,
  .transport button:hover {
    background: var(--glass-active);
    color: var(--text);
  }

  .content {
    display: grid;
    gap: 10px;
    min-height: 0;
    padding: 12px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }

  .active-device,
  .device-row {
    border: 1px solid var(--stroke);
    border-radius: 10px;
    background: var(--glass-hover);
  }

  .active-device {
    display: grid;
    gap: 10px;
    padding: 12px;
  }

  .active-device.playing {
    border-color: color-mix(in srgb, var(--accent-green) 23%, transparent);
    background: linear-gradient(
      140deg,
      color-mix(in srgb, var(--accent-green) 10%, transparent),
      var(--glass-hover) 85%
    );
  }

  .active-heading {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    color: var(--text-dim);
    font-size: 11.5px;
    white-space: nowrap;
  }

  .active-heading strong {
    color: var(--text);
    font-weight: 650;
  }

  .status-dot {
    flex: none;
    width: 6px;
    height: 6px;
    margin-right: 2px;
    border-radius: 50%;
    background: currentColor;
  }

  .playing .status-dot {
    color: var(--accent-green);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-green) 15%, transparent);
  }

  .device-copy {
    display: grid;
    min-width: 0;
    gap: 1px;
  }

  .song,
  .name {
    color: var(--text);
    font-weight: 600;
  }

  .song {
    font-size: 14px;
  }

  .name {
    font-size: 12.5px;
  }

  .secondary {
    color: var(--text-dim);
    font-size: 11.5px;
  }

  .device-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 9px;
  }

  .device-identity {
    min-width: 0;
  }

  .device-icon {
    width: 33px;
    height: 33px;
    border-radius: 8px;
    background: var(--glass-active);
    color: var(--text-dim);
  }

  .local .device-icon {
    color: var(--text);
  }

  .handoff {
    justify-self: end;
    min-height: 29px;
    padding: 0 10px;
    border: 1px solid var(--stroke-strong);
    border-radius: 7px;
    font-size: 11.5px;
    font-weight: 650;
    white-space: nowrap;
  }

  .handoff:hover:not(:disabled) {
    background: var(--glass-active);
  }

  .handoff.primary {
    background: var(--text);
    color: var(--bg);
  }

  .handoff.primary:hover:not(:disabled) {
    background: var(--accent);
  }

  .handoff:disabled {
    opacity: 0.55;
  }

  .other-devices,
  .device-list {
    display: grid;
    gap: 6px;
  }

  h3 {
    padding: 2px 2px 0;
    color: var(--text-dim);
    font-size: 11.5px;
    font-weight: 600;
  }

  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
  }

  .other.has-track .controls {
    grid-column: 1 / -1;
  }

  .transport,
  .volume {
    display: flex;
    align-items: center;
  }

  .transport {
    gap: 2px;
  }

  .transport button {
    display: grid;
    place-items: center;
    width: 31px;
    height: 30px;
    border-radius: 7px;
    color: var(--text-dim);
  }

  .transport .play {
    background: var(--glass-active);
    color: var(--text);
  }

  .transport .play:hover {
    background: var(--accent-soft);
  }

  .volume {
    gap: 7px;
    width: min(116px, 50%);
    min-width: 0;
    color: var(--text-dim);
  }

  .other:not(.has-track) .volume {
    width: 86px;
  }

  .volume input {
    width: 100%;
    min-width: 0;
    margin: 0;
  }

  .empty {
    padding: 8px 2px;
    color: var(--text-dim);
    font-size: 12px;
  }
</style>
