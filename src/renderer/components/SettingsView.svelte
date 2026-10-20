<script lang="ts">
  import type { CacheStats, Settings } from '@shared/types'
  import { api } from '../lib/api'
  import { player } from '../lib/player.svelte'
  import Icon from './Icon.svelte'

  const CAPS = [
    { bytes: 512 * 1024 * 1024, label: '512 MB' },
    { bytes: 1024 * 1024 * 1024, label: '1 GB' },
    { bytes: 2 * 1024 * 1024 * 1024, label: '2 GB' },
    { bytes: 4 * 1024 * 1024 * 1024, label: '4 GB' }
  ]

  let current = $state<Settings | null>(null)
  let stats = $state<CacheStats | null>(null)

  $effect(() => {
    void load()
  })

  async function load(): Promise<void> {
    const [settings, cache] = await Promise.all([api.settings.get(), api.cache.stats()])
    current = settings
    stats = cache
    player.applySettings(settings)
  }

  async function patch(update: Partial<Settings>): Promise<void> {
    if (!current) return
    current = await api.settings.set(update)
    player.applySettings(current)
    stats = await api.cache.stats()
  }

  async function clearCache(): Promise<void> {
    stats = await api.cache.clear()
  }

  function size(bytes: number): string {
    const gb = bytes / 1024 ** 3
    if (gb >= 1) return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`
    return `${Math.round(bytes / 1024 / 1024)} MB`
  }
</script>

<div class="view">
  <header class="head">
    <h1>Settings</h1>
    <p>Everything here stays on this machine.</p>
  </header>

  <section>
    <h2>Playback</h2>

    <div class="row">
      <div class="label">
        <span>Audio quality</span>
        <span class="hint">
          Best available is what YouTube serves anonymously (~130 kbps). Data saver caps around
          64 kbps and roughly halves data use.
        </span>
      </div>
      <div class="segmented">
        <button
          class:on={current?.audioQuality === 'best'}
          onclick={() => patch({ audioQuality: 'best' })}>Best available</button
        >
        <button
          class:on={current?.audioQuality === 'data-saver'}
          onclick={() => patch({ audioQuality: 'data-saver' })}>Data saver</button
        >
      </div>
    </div>

    <div class="row">
      <div class="label">
        <span>Autoplay</span>
        <span class="hint">Keep playing similar songs when the queue ends.</span>
      </div>
      <button
        class="switch"
        class:on={current?.autoplay}
        role="switch"
        aria-checked={current?.autoplay}
        aria-label="Autoplay"
        onclick={() => patch({ autoplay: !current?.autoplay })}
      >
        <span class="thumb"></span>
      </button>
    </div>
  </section>

  <section>
    <h2>Storage</h2>

    <div class="row">
      <div class="label">
        <span>Cache limit</span>
        <span class="hint">
          {stats
            ? `Using ${size(stats.bytes)} of ${size(stats.capBytes)} · ${stats.entries} tracks`
            : 'Reading cache…'}
        </span>
      </div>
      <div class="segmented">
        {#each CAPS as cap (cap.bytes)}
          <button
            class:on={current?.cacheCapBytes === cap.bytes}
            onclick={() => patch({ cacheCapBytes: cap.bytes })}>{cap.label}</button
          >
        {/each}
      </div>
    </div>

    <div class="row">
      <div class="label">
        <span>Clear cache</span>
        <span class="hint">Cached audio plays offline and instantly. Clearing it frees the space.</span>
      </div>
      <button class="ghost" onclick={clearCache} disabled={!stats || stats.entries === 0}>Clear</button>
    </div>
  </section>

  <p class="about">
    <Icon name="disc" size={14} />
    <span>Viby · no ads, no account, nothing to sign up for.</span>
  </p>
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 26px;
    padding: 4px 2px 24px;
    max-width: 780px;
  }

  h1 {
    font-size: 30px;
    font-weight: 640;
    margin: 0 0 4px;
    letter-spacing: -0.028em;
  }

  .head p {
    margin: 0;
    color: var(--text-faint);
    font-size: 12.5px;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  h2 {
    font-size: 11px;
    font-weight: 550;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-faint);
    margin: 0 0 8px;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 13px 0;
    border-top: 1px solid var(--stroke);
  }

  .label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .label > span:first-child {
    font-size: 13.5px;
  }

  .hint {
    font-size: 12px;
    color: var(--text-faint);
    line-height: 1.5;
  }

  .segmented {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .segmented button {
    border: 1px solid var(--stroke);
    border-radius: 999px;
    padding: 6px 13px;
    font-size: 12px;
    color: var(--text-dim);
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease),
      border-color var(--speed) var(--ease);
  }

  .segmented button:hover {
    color: var(--text);
    border-color: var(--stroke-strong);
  }

  .segmented button.on {
    background: var(--text);
    border-color: transparent;
    color: #08080b;
    font-weight: 550;
  }

  .switch {
    width: 40px;
    height: 22px;
    border-radius: 999px;
    background: var(--glass-active);
    border: 1px solid var(--stroke);
    padding: 2px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    transition: background var(--speed) var(--ease);
  }

  .switch .thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--text-faint);
    transition:
      transform var(--speed) var(--ease),
      background var(--speed) var(--ease);
  }

  .switch.on {
    background: var(--text);
    border-color: transparent;
  }

  .switch.on .thumb {
    transform: translateX(18px);
    background: #08080b;
  }

  .ghost {
    border: 1px solid var(--stroke);
    border-radius: 999px;
    padding: 7px 14px;
    font-size: 12px;
    color: var(--text-dim);
    flex-shrink: 0;
  }

  .ghost:hover:not(:disabled) {
    background: var(--glass-hover);
    color: var(--text);
  }

  .about {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 0 0;
    font-size: 11.5px;
    color: var(--text-faint);
  }
</style>
