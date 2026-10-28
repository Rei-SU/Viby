<script lang="ts">
  import type { CacheStats, Settings, UpdateState, YtDlpInfo } from '@shared/types'
  import { api } from '../lib/api'
  import { artwork } from '../lib/artwork.svelte'
  import { player } from '../lib/player.svelte'
  import { downloads } from '../lib/downloads.svelte'
  import { network } from '../lib/network.svelte'
  import { nav } from '../lib/nav.svelte'
  import { updates } from '../lib/updates.svelte'
  import Icon from './Icon.svelte'

  const CAPS = [
    { bytes: 512 * 1024 * 1024, label: '512 MB' },
    { bytes: 1024 * 1024 * 1024, label: '1 GB' },
    { bytes: 2 * 1024 * 1024 * 1024, label: '2 GB' },
    { bytes: 4 * 1024 * 1024 * 1024, label: '4 GB' }
  ]
  const trayName = api.platform === 'darwin' ? 'menu bar' : 'system tray'

  let current = $state<Settings | null>(null)
  let stats = $state<CacheStats | null>(null)
  let resolver = $state<YtDlpInfo | null>(null)
  let resolverBusy = $state(false)
  let resolverError = $state('')
  let update = $derived(updates.state)

  $effect(() => {
    void load()
  })

  async function load(): Promise<void> {
    const [settings, cache] = await Promise.all([api.settings.get(), api.cache.stats()])
    current = settings
    stats = cache
    player.applySettings(settings)
    await downloads.init()
    void loadResolver()
  }

  async function loadResolver(): Promise<void> {
    resolverBusy = true
    resolverError = ''
    try {
      const result = await api.ytDlp.info()
      if (result.ok) resolver = result.data
      else resolverError = result.error
    } catch (err) {
      resolverError = err instanceof Error ? err.message : String(err)
    } finally {
      resolverBusy = false
    }
  }

  async function updateResolver(): Promise<void> {
    resolverBusy = true
    resolverError = ''
    try {
      const result = await api.ytDlp.update()
      if (result.ok) resolver = result.data
      else resolverError = result.error
    } catch (err) {
      resolverError = err instanceof Error ? err.message : String(err)
    } finally {
      resolverBusy = false
    }
  }

  async function patch(update: Partial<Settings>): Promise<void> {
    if (!current) return
    current = await api.settings.set(update)
    player.applySettings(current)
    stats = await api.cache.stats()
  }

  async function toggleOffline(): Promise<void> {
    if (!current) return
    await network.setMode(current.offlineMode === 'offline' ? 'auto' : 'offline')
    current = await api.settings.get()
  }

  async function clearCache(): Promise<void> {
    try {
      stats = await api.cache.clear()
      // The renderer's artwork map still points at local URLs that were just
      // deleted; reset it so covers re-resolve instead of rendering broken.
      artwork.forget()
    } catch (err) {
      console.error('[cache] clear failed', err)
    }
  }

  async function checkUpdates(): Promise<void> {
    await updates.check()
  }

  async function downloadUpdate(): Promise<void> {
    await updates.download()
  }

  async function cancelDownload(): Promise<void> {
    await updates.cancel()
  }

  async function installUpdate(): Promise<void> {
    await updates.install()
  }

  async function skipUpdate(): Promise<void> {
    const version = update?.version
    if (!version) return
    await patch({ skippedUpdateVersion: version })
    await updates.check()
  }

  async function clearSkipped(): Promise<void> {
    if (!current?.skippedUpdateVersion) return
    await patch({ skippedUpdateVersion: '' })
    await updates.check()
  }

  type UpdateAction = { label: string; disabled: boolean; run: () => Promise<void> }

  function actionFor(state: UpdateState): UpdateAction {
    switch (state.phase) {
      case 'checking':
        return { label: 'Checking…', disabled: true, run: checkUpdates }
      case 'downloading':
        return { label: 'Downloading…', disabled: true, run: downloadUpdate }
      case 'available':
        return { label: 'Download', disabled: false, run: downloadUpdate }
      case 'ready':
        return { label: 'Restarting…', disabled: true, run: installUpdate }
      case 'manual':
        return { label: 'Quit Viby', disabled: false, run: installUpdate }
      default:
        return { label: 'Check for updates', disabled: false, run: checkUpdates }
    }
  }

  let updateAction = $derived(
    update ? actionFor(update) : { label: 'Check for updates', disabled: true, run: checkUpdates }
  )

  function updateHint(state: UpdateState): string {
    switch (state.phase) {
      case 'idle':
        return `Viby ${state.currentVersion}. Checks GitHub when you ask — no account, no telemetry.`
      case 'checking':
        return 'Checking GitHub…'
      case 'up-to-date':
        return state.message ?? `You're up to date (${state.currentVersion}).`
      case 'available':
        return state.canInstall
          ? `Version ${state.version} is available. Downloading it restarts Viby to install it.`
          : `Version ${state.version} is available. Viby downloads the installer for this Mac and opens it.`
      case 'downloading':
        return `Downloading ${state.version ?? 'the update'}… ${Math.round((state.progress ?? 0) * 100)}%${
          state.canInstall ? ' Viby restarts when it finishes.' : ''
        }`
      case 'ready':
        return `Version ${state.version} is ready. Restarting Viby to install it…`
      case 'manual':
        return state.message ?? 'Installer opened. Drag Viby into Applications, then reopen it.'
      case 'error':
        return state.message ?? 'Could not check for updates.'
    }
  }

  function size(bytes: number | null): string {
    if (bytes == null) return '—'
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
          Best available streams at the highest quality the catalogue offers (~130 kbps). Data
          saver caps around 64 kbps and roughly halves data use.
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

    <div class="row">
      <div class="label">
        <span>Keep playing when closed</span>
        <span class="hint">
          Closing the window hides Viby in the {trayName} and keeps music playing. Quit from
          there to stop it.
        </span>
      </div>
      <button
        class="switch"
        class:on={current?.backgroundPlayback}
        role="switch"
        aria-checked={current?.backgroundPlayback}
        aria-label="Keep playing when the window is closed"
        onclick={() => patch({ backgroundPlayback: !current?.backgroundPlayback })}
      >
        <span class="thumb"></span>
      </button>
    </div>

    <div class="row">
      <div class="label">
        <span>Launch at login</span>
        <span class="hint">Open Viby when you sign in to this computer.</span>
      </div>
      <button
        class="switch"
        class:on={current?.launchAtLogin}
        role="switch"
        aria-checked={current?.launchAtLogin}
        aria-label="Launch at login"
        onclick={() => patch({ launchAtLogin: !current?.launchAtLogin })}
      >
        <span class="thumb"></span>
      </button>
    </div>

    <div class="row">
      <div class="label">
        <span>Start minimized</span>
        <span class="hint">
          A login launch opens in the taskbar or Dock without taking focus. Restore it from
          there, or from the {trayName} when that is enabled.
        </span>
      </div>
      <button
        class="switch"
        class:on={current?.launchMinimized}
        role="switch"
        aria-checked={current?.launchMinimized}
        aria-label="Start minimized"
        disabled={!current?.launchAtLogin}
        title={current?.launchAtLogin ? undefined : 'Turn on Launch at login first'}
        onclick={() => patch({ launchMinimized: !current?.launchMinimized })}
      >
        <span class="thumb"></span>
      </button>
    </div>
  </section>

  <section>
    <h2>Connectivity</h2>

    <div class="row">
      <div class="label">
        <span>Offline mode</span>
        <span class="hint">
          {#if network.state.forcedOffline}
            On. Only downloads play, and browsing waits until you switch it off.
          {:else if network.state.status === 'online'}
            Automatic. Viby follows your connection; downloads are always available.
          {:else}
            Automatic — {network.detail.toLowerCase()} Downloads still play.
          {/if}
        </span>
      </div>
      <button
        class="switch"
        class:on={current?.offlineMode === 'offline'}
        role="switch"
        aria-checked={current?.offlineMode === 'offline'}
        aria-label="Offline mode"
        onclick={toggleOffline}
      >
        <span class="thumb"></span>
      </button>
    </div>
  </section>

  <section>
    <h2>Updates</h2>

    <div class="row">
      <div class="label">
        <span>Viby {update?.currentVersion ?? ''}</span>
        <span class="hint">
          {update ? updateHint(update) : 'Reading the current version…'}
        </span>
      </div>
      <div class="actions">
        <button class="ghost" onclick={updateAction.run} disabled={updateAction.disabled}>
          {updateAction.label}
        </button>
        {#if update?.phase === 'downloading'}
          <button class="ghost" onclick={cancelDownload}>Cancel</button>
        {:else if update?.phase === 'available'}
          <button class="ghost" onclick={skipUpdate}>Skip this version</button>
        {:else if update?.phase === 'manual'}
          <button class="ghost" onclick={downloadUpdate}>Download again</button>
        {/if}
      </div>
    </div>

    <div class="row">
      <div class="label">
        <span>Check automatically</span>
        <span class="hint">
          Checks GitHub shortly after launch, at most every six hours. Nothing is downloaded
          until you ask.
        </span>
      </div>
      <button
        class="switch"
        class:on={current?.autoUpdateCheck}
        role="switch"
        aria-checked={current?.autoUpdateCheck}
        aria-label="Check for updates automatically"
        onclick={() => patch({ autoUpdateCheck: !current?.autoUpdateCheck })}
      >
        <span class="thumb"></span>
      </button>
    </div>

    {#if current?.skippedUpdateVersion}
      <div class="row">
        <div class="label">
          <span>Skipped version</span>
          <span class="hint">
            {current.skippedUpdateVersion} will not be offered again. Newer releases still will.
          </span>
        </div>
        <button class="ghost" onclick={clearSkipped}>Offer it again</button>
      </div>
    {/if}
  </section>

  <section>
    <h2>Playback engine</h2>

    <div class="row">
      <div class="label">
        <span>YT-DLP resolver</span>
        <span class="hint">
          {#if resolverError}
            {resolverError}
          {:else if resolver}
            Version {resolver.version} · {resolver.runtime}. Updating pulls the latest extractor fixes.
          {:else}
            Reading the resolver version…
          {/if}
        </span>
      </div>
      <button class="ghost" onclick={updateResolver} disabled={resolverBusy}>
        {resolverBusy ? 'Updating…' : 'Update resolver'}
      </button>
    </div>
  </section>

  <section>
    <h2>Storage</h2>

    <div class="row">
      <div class="label">
        <span>Downloads</span>
        <span class="hint">
          {#if downloads.stats}
            {downloads.stats.entries} {downloads.stats.entries === 1 ? 'song' : 'songs'} · {size(
              downloads.stats.bytes
            )} used · {downloads.stats.freeBytes != null
              ? `${size(downloads.stats.freeBytes)} free`
              : 'free space unavailable'}. Explicit files are never evicted.
          {:else}
            Reading downloads…
          {/if}
        </span>
      </div>
      <button class="ghost" onclick={() => nav.go('library')}>Manage</button>
    </div>

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
        <span class="hint">
          A rolling cache keeps playback smooth and sometimes works offline. Clearing it frees
          space but never touches your downloads.
        </span>
      </div>
      <button class="ghost" onclick={clearCache} disabled={!stats || stats.entries === 0}>Clear</button>
    </div>
  </section>

  <p class="about">
    <Icon name="disc" size={14} />
    <span>Viby · no ads, no subscription, no sign-in required.</span>
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

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
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

  .switch:disabled {
    opacity: 0.45;
    cursor: default;
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
