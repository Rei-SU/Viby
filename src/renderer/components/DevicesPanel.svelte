<script lang="ts">
  import type { ConnectDevice } from '@shared/connect'
  import { connect } from '../lib/connect.svelte'
  import Icon from './Icon.svelte'

  let panel = $state<HTMLElement>()

  function onWindowClick(event: MouseEvent): void {
    if (!connect.open) return
    const target = event.target as Element | null
    if (!target) return
    if (panel?.contains(target)) return
    if (target.closest?.('[data-connect-toggle]')) return
    connect.close()
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && connect.open) connect.close()
  }

  function volumePercent(device: ConnectDevice): number {
    return Math.round((device.muted ? 0 : device.volume) * 100)
  }

  function nowText(device: ConnectDevice | null): string {
    if (!device?.track) return 'Nothing playing'
    return `${device.track.title} — ${device.track.artist}`
  }

  function stateText(device: ConnectDevice): string {
    if (device.playing) return 'Playing'
    return device.track ? 'Paused' : 'Idle'
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKeydown} />

{#if connect.open}
  <section bind:this={panel} class="panel" aria-label="Devices">
    <header>
      <h2>Devices</h2>
      <button class="x" aria-label="Close devices" onclick={() => connect.close()}>
        <Icon name="close" size={14} />
      </button>
    </header>

    {#if !connect.available}
      <p class="empty">Connecting to this account's devices…</p>
    {:else}
      <div class="rows">
        <div class="row">
          <div class="who">
            <span class="name">{connect.self?.name ?? connect.name}<span class="tag">this device</span></span>
            <span class="sub">{connect.self?.platform ?? ''}</span>
            <span class="now">{nowText(connect.self)}</span>
          </div>
        </div>

        {#if connect.others.length === 0}
          <p class="empty">No other devices are online.</p>
        {/if}

        {#each connect.others as device (device.id)}
          <div class="row">
            <div class="who">
              <span class="name">{device.name}</span>
              <span class="sub">{device.platform} · {stateText(device)}</span>
              <span class="now">{nowText(device)}</span>
            </div>
            <div class="actions">
              <div class="transport">
                <button
                  aria-label="Previous on {device.name}"
                  disabled={!device.track}
                  onclick={() => void connect.remotePrevious(device)}
                >
                  <Icon name="prev" size={13} />
                </button>
                <button
                  aria-label={device.playing ? `Pause ${device.name}` : `Play on ${device.name}`}
                  disabled={!device.track}
                  onclick={() => void connect.remotePlayPause(device)}
                >
                  <Icon name={device.playing ? 'pause' : 'play'} size={13} />
                </button>
                <button
                  aria-label="Next on {device.name}"
                  disabled={!device.track}
                  onclick={() => void connect.remoteNext(device)}
                >
                  <Icon name="next" size={13} />
                </button>
              </div>
              <label class="vol">
                <span class="visually-hidden">Volume on {device.name}</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={volumePercent(device)}
                  onchange={(event) =>
                    void connect.remoteVolume(device, Number(event.currentTarget.value) / 100)}
                />
              </label>
              <button
                class="here"
                disabled={connect.busyId !== ''}
                onclick={() => void connect.playHere(device)}
              >
                {connect.busyId === device.id ? 'Connecting…' : 'Play here'}
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .panel {
    position: absolute;
    right: 0;
    bottom: calc(100% + 14px);
    width: 340px;
    max-width: calc(100vw - 40px);
    padding: 12px 12px 8px;
    border: 1px solid var(--stroke);
    border-radius: var(--radius);
    background: var(--surface, var(--glass));
    box-shadow: 0 18px 50px rgb(0 0 0 / 45%);
    z-index: 40;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px 8px;
  }

  h2 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .x {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text-faint);
    cursor: pointer;
  }

  .x:hover {
    color: var(--text);
    background: var(--hover, rgb(255 255 255 / 6%));
  }

  .rows {
    display: flex;
    flex-direction: column;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 4px;
    border-top: 1px solid var(--stroke);
  }

  .row:first-child {
    border-top: 0;
  }

  .who {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .name {
    font-size: 13px;
    font-weight: 550;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tag {
    margin-left: 6px;
    font-size: 10.5px;
    font-weight: 500;
    color: var(--text-faint);
  }

  .sub {
    font-size: 11px;
    color: var(--text-faint);
  }

  .now {
    font-size: 12px;
    color: var(--text-dim, var(--text-faint));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .transport {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .transport button {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text);
    cursor: pointer;
  }

  .transport button:hover:not(:disabled) {
    background: var(--hover, rgb(255 255 255 / 6%));
  }

  .transport button:disabled {
    color: var(--text-faint);
    cursor: default;
  }

  .vol {
    flex: 1;
    display: flex;
    align-items: center;
    min-width: 60px;
  }

  .vol input {
    width: 100%;
    accent-color: var(--accent);
  }

  .here {
    flex-shrink: 0;
    padding: 5px 10px;
    border: 1px solid var(--stroke);
    border-radius: 999px;
    background: none;
    color: var(--text);
    font-size: 11.5px;
    cursor: pointer;
    white-space: nowrap;
  }

  .here:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .here:disabled {
    color: var(--text-faint);
    cursor: default;
  }

  .empty {
    margin: 4px 4px 10px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-faint);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
