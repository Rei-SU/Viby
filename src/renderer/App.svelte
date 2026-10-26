<script lang="ts">
  import { onMount } from 'svelte'
  import { nav, type View } from './lib/nav.svelte'
  import { player } from './lib/player.svelte'
  import { api } from './lib/api'
  import PlayerBar from './components/PlayerBar.svelte'
  import HomeView from './components/HomeView.svelte'
  import OfflineHome from './components/OfflineHome.svelte'
  import SearchView from './components/SearchView.svelte'
  import SearchBar from './components/SearchBar.svelte'
  import DetailView from './components/DetailView.svelte'
  import TrackView from './components/TrackView.svelte'
  import LibraryView from './components/LibraryView.svelte'
  import CollectionView from './components/CollectionView.svelte'
  import DownloadCollectionView from './components/DownloadCollectionView.svelte'
  import PlaylistPicker from './components/PlaylistPicker.svelte'
  import LyricsPanel from './components/LyricsPanel.svelte'
  import { lyrics } from './lib/lyrics.svelte'
  import ImportView from './components/ImportView.svelte'
  import SettingsView from './components/SettingsView.svelte'
  import Queue from './components/Queue.svelte'
  import Icon from './components/Icon.svelte'
  import { network } from './lib/network.svelte'
  import { updates } from './lib/updates.svelte'
  import { downloads } from './lib/downloads.svelte'
  import { artwork } from './lib/artwork.svelte'
  import { searchState } from './lib/search.svelte'

  const navItems: {
    id: View
    label: string
    icon: 'home' | 'search' | 'disc' | 'list' | 'download' | 'gear' | 'plus'
  }[] = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'library', label: 'Library', icon: 'disc' },
    { id: 'queue', label: 'Queue', icon: 'list' },
    { id: 'import', label: 'Import', icon: 'plus' },
    { id: 'settings', label: 'Settings', icon: 'gear' }
  ]

  const isMac = api.platform === 'darwin'
  const isWin = api.platform === 'win32'

  // The lyrics sidebar is sized in viewport units. Disable the grid transition
  // while the window is being resized, otherwise the track chases the pointer
  // for 300ms and the page feels laggy.
  let resizing = $state(false)
  let resizeTimer: ReturnType<typeof setTimeout> | null = null

  function onResize(): void {
    resizing = true
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => (resizing = false), 180)
  }

  function isActive(id: View): boolean {
    return nav.view === id && !nav.detail && !nav.track && !nav.collection
  }

  function labelFor(item: (typeof navItems)[number]): string {
    if (item.id === 'settings' && updates.pending) return 'Settings — update available'
    if (network.localFirst && item.id === 'import') {
      return `${item.label} needs a connection`
    }
    return item.label
  }

  // The profile avatar is an intentional placeholder until accounts exist.
  let profileNote = $state(false)
  let profileTimer: ReturnType<typeof setTimeout> | null = null

  let netMenu = $state(false)
  let backOnline = $state(false)
  let backOnlineTimer: ReturnType<typeof setTimeout> | null = null
  let wasLocalFirst = network.localFirst
  let copiedError = $state(false)
  let copiedErrorTimer: ReturnType<typeof setTimeout> | null = null

  $effect(() => {
    player.error
    copiedError = false
    if (copiedErrorTimer) {
      clearTimeout(copiedErrorTimer)
      copiedErrorTimer = null
    }
  })

  async function copyPlaybackError(): Promise<void> {
    const message = player.error
    if (!message) return
    try {
      if (!(await api.app.copyText(message))) return
      copiedError = true
      if (copiedErrorTimer) clearTimeout(copiedErrorTimer)
      copiedErrorTimer = setTimeout(() => {
        copiedError = false
        copiedErrorTimer = null
      }, 1600)
    } catch {
      // Clipboard access is best-effort.
    }
  }

  // A reconnect should feel acknowledged, without stealing the view the user
  // was on. The pill disappears on its own; this is the only extra chrome.
  $effect(() => {
    const local = network.localFirst
    const wasLocal = wasLocalFirst
    wasLocalFirst = local

    // Search needs the catalog. Drop online results as soon as connectivity
    // changes; they must not linger over the offline Search notice.
    if (local !== wasLocal) searchState.refreshSource()

    if (wasLocal && !local) {
      backOnline = true
      if (backOnlineTimer) clearTimeout(backOnlineTimer)
      backOnlineTimer = setTimeout(() => (backOnline = false), 2600)
      // Artwork that missed while offline can fill in now.
      artwork.retry()
    }
  })

  function showProfileNote(): void {
    profileNote = true
    if (profileTimer) clearTimeout(profileTimer)
    profileTimer = setTimeout(() => (profileNote = false), 2600)
  }

  async function goOnline(): Promise<void> {
    netMenu = false
    await network.setMode('auto')
  }

  // Remember where you were scrolled in each view, so Back feels like Back.
  let main: HTMLElement | undefined
  const scrollMemory = new Map<string, number>()
  let scrollKey = ''

  function viewKey(): string {
    if (nav.track) return `track:${nav.track.id}`
    if (nav.detail) return `detail:${nav.detail.id}`
    if (nav.collection) {
      if (nav.collection.kind === 'liked') return 'collection:liked'
      if (nav.collection.kind === 'playlist') return `collection:${nav.collection.id}`
      return `collection:${nav.collection.key}`
    }
    return nav.view
  }

  $effect(() => {
    const next = viewKey()
    if (next === scrollKey) return
    scrollKey = next
    const saved = scrollMemory.get(next) ?? 0
    requestAnimationFrame(() => {
      if (main) main.scrollTop = saved
    })
  })

  function onScroll(): void {
    if (main && scrollKey) scrollMemory.set(scrollKey, main.scrollTop)
  }

  // Keep the panel in sync when the track changes while it is open.
  $effect(() => {
    const track = player.current
    if (lyrics.open && track) void lyrics.load(track)
  })

  onMount(() => {
    void network.init()
    void downloads.init()
    void player.init()
    updates.init()
    return api.app.onOpenSettings(() => nav.go('settings'))
  })
</script>

<svelte:window onclick={() => (netMenu = false)} onresize={onResize} />

<div class="layout" class:lyrics-open={lyrics.open} class:resizing>
  <!-- The window has no native title bar on macOS, so this strip is the only
       draggable area. Everything interactive inside it must opt out. -->
  <header class="titlebar" class:mac={isMac} class:win={isWin}>
    <div class="chrome-left">
      <div class="history">
        <button
          class="chrome-btn"
          title="Back"
          aria-label="Back"
          disabled={!nav.canGoBack}
          onclick={() => nav.back()}
        >
          <Icon name="back" size={16} />
        </button>
        <button
          class="chrome-btn"
          title="Forward"
          aria-label="Forward"
          disabled={!nav.canGoForward}
          onclick={() => nav.forward()}
        >
          <Icon name="forward" size={16} />
        </button>
      </div>
      <span class="brand">Viby</span>
    </div>

    <div class="search-slot">
      <SearchBar />
    </div>

    <div class="titlebar-right">
      {#if network.localFirst}
        <div class="net-wrap">
          <button
            class="net-pill local"
            title={network.detail || network.label}
            onclick={(event) => {
              event.stopPropagation()
              netMenu = !netMenu
            }}
          >
            <span class="net-dot" class:forced={network.state.forcedOffline}></span>
            <span>{network.label}</span>
          </button>

          {#if netMenu}
            <div class="net-menu">
              <p>{network.detail || 'Connected.'}</p>
              <button
                onclick={() => {
                  netMenu = false
                  nav.go('library')
                }}
              >
                Manage downloads
              </button>
              {#if network.state.forcedOffline}
                <button onclick={goOnline}>Go online</button>
              {:else}
                <button
                  onclick={() => {
                    netMenu = false
                    nav.go('settings')
                  }}
                >
                  Offline settings
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      <button
        class="profile"
        title="Profile — coming later"
        aria-label="Profile — coming later"
        onclick={showProfileNote}
      >
        <Icon name="user" size={15} />
      </button>
    </div>

    {#if profileNote}
      <div class="profile-note" role="status">Profiles are coming later.</div>
    {/if}
  </header>

  <!-- Fixed icon rail: the label doubles as the hover tooltip, and the button
       carries the same text as its accessible name. -->
  <aside class="sidebar">
    <nav aria-label="Primary">
      {#each navItems as item (item.id)}
        {@const active = isActive(item.id)}
        {@const label = labelFor(item)}
        <button
          class="nav"
          class:on={active}
          aria-current={active ? 'page' : undefined}
          aria-label={label}
          disabled={network.localFirst && item.id === 'import'}
          onclick={() => nav.go(item.id)}
        >
          <Icon name={item.icon} size={18} />
          <span class="nav-label" aria-hidden="true">{label}</span>
          {#if item.id === 'settings' && updates.pending}
            <span class="update-dot" aria-hidden="true"></span>
          {/if}
        </button>
      {/each}
    </nav>
  </aside>

  <main class="content scroll" bind:this={main} onscroll={onScroll}>
    {#if nav.track}
      <TrackView track={nav.track} />
    {:else if nav.detail}
      <DetailView item={nav.detail} />
    {:else if nav.collection}
      {#if nav.collection.kind === 'download'}
        <DownloadCollectionView collectionKey={nav.collection.key} />
      {:else}
        <CollectionView ref={nav.collection} />
      {/if}
    {:else if nav.view === 'home'}
      {#if network.localFirst}
        <OfflineHome />
      {:else}
        <HomeView />
      {/if}
    {:else if nav.view === 'search'}
      <SearchView />
    {:else if nav.view === 'library'}
      <LibraryView />
    {:else if nav.view === 'queue'}
      <Queue />
    {:else if nav.view === 'settings'}
      <SettingsView />
    {:else if network.localFirst}
      <div class="offline-page">
        <p class="eyebrow">Offline</p>
        <h1>Import needs a connection</h1>
        <p>{network.detail || 'Reconnect to import a playlist.'}</p>
        <div class="offline-actions">
          <button class="primary" onclick={() => nav.go('library')}>Open Library</button>
        </div>
      </div>
    {:else}
      <ImportView />
    {/if}
  </main>

  <LyricsPanel />
  <PlayerBar />
  <PlaylistPicker />

  <div class="alerts">
    {#if backOnline}
      <div class="toast" role="status">
        <Icon name="check" size={14} /> Back online
      </div>
    {/if}

    {#if player.error}
      <div class="alert-card">
        <span class="alert-mark" aria-hidden="true"><Icon name="alert" size={16} /></span>
        <div class="alert-copy">
          <strong>Playback problem</strong>
          <p>{player.error}</p>
        </div>
        <div class="alert-actions">
          <button
            class="alert-action"
            title={copiedError ? 'Copied' : 'Copy error message'}
            aria-label={copiedError ? 'Error copied' : 'Copy error message'}
            onclick={() => void copyPlaybackError()}
          >
            {#if copiedError}<Icon name="check" size={12} />{/if}
            {copiedError ? 'Copied' : 'Copy'}
          </button>
          <button
            class="alert-close"
            onclick={() => (player.error = null)}
            aria-label="Dismiss playback problem"
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      </div>
    {/if}
  </div>
  <div class="sr-alert" role="alert" aria-atomic="true">
    {player.error ? `Playback problem. ${player.error}` : ''}
  </div>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr) 0px;
    grid-template-rows: var(--titlebar-h) minmax(0, 1fr) var(--player-h);
    height: 100vh;
    transition: grid-template-columns 300ms var(--ease);
  }

  /* The lyrics panel lives in the third column. The titlebar and player stay
     full width; only the content row gives up space. */
  .layout.lyrics-open {
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr) var(--lyrics-w);
  }

  /* Window resizes should reflow immediately, not animate behind the pointer. */
  .layout.resizing {
    transition: none;
  }

  .titlebar {
    position: relative;
    /* Above the page content and below the playlist picker (90). */
    z-index: 70;
    grid-column: 1 / -1;
    grid-row: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    background: var(--glass);
    backdrop-filter: blur(26px) saturate(150%);
    -webkit-backdrop-filter: blur(26px) saturate(150%);
    border-bottom: 1px solid var(--stroke);
    -webkit-app-region: drag;
    user-select: none;
  }

  .titlebar.mac {
    padding-left: 84px;
  }

  /* Windows draws the min/max/close buttons as an overlay on the right of the
     hidden title bar; reserve room so they never sit on top of app content. */
  .titlebar.win {
    padding-right: 150px;
  }

  .chrome-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .search-slot {
    position: absolute;
    top: 50%;
    left: 50%;
    width: clamp(280px, 38vw, 440px);
    transform: translate(-50%, -50%);
    -webkit-app-region: no-drag;
  }

  .chrome-btn {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    color: var(--text-dim);
    -webkit-app-region: no-drag;
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .chrome-btn:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .chrome-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .chrome-btn:disabled:hover {
    background: transparent;
    color: var(--text-dim);
  }

  .history {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .brand {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text);
  }

  .net-wrap {
    position: relative;
    flex-shrink: 0;
    -webkit-app-region: no-drag;
  }

  .titlebar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
    flex-shrink: 0;
    -webkit-app-region: no-drag;
  }

  .net-pill {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 27px;
    padding: 0 10px;
    border: 1px solid var(--stroke);
    border-radius: 999px;
    background: var(--glass);
    color: var(--text-dim);
    font-size: 11px;
    white-space: nowrap;
    transition:
      border-color var(--speed) var(--ease),
      color var(--speed) var(--ease),
      background var(--speed) var(--ease);
  }

  .net-pill:hover {
    border-color: var(--stroke-strong);
    background: var(--glass-hover);
    color: var(--text);
  }

  .net-pill.local {
    color: #f0c477;
    border-color: rgba(240, 196, 119, 0.26);
    background: rgba(240, 196, 119, 0.08);
  }

  .net-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #7ddc9a;
    box-shadow: 0 0 0 3px rgba(125, 220, 154, 0.1);
  }

  .net-pill.local .net-dot {
    background: #f0c477;
    box-shadow: 0 0 0 3px rgba(240, 196, 119, 0.12);
  }

  .net-dot.forced {
    background: #f0c477;
  }

  .net-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 80;
    width: 220px;
    padding: 8px;
    border: 1px solid var(--stroke);
    border-radius: var(--radius);
    background: var(--glass-strong);
    backdrop-filter: blur(26px) saturate(150%);
    -webkit-backdrop-filter: blur(26px) saturate(150%);
    box-shadow: var(--shadow-dock);
    animation: note-in 130ms var(--ease);
  }

  .net-menu p {
    margin: 2px 6px 8px;
    color: var(--text-faint);
    font-size: 11px;
    line-height: 1.45;
  }

  .net-menu button {
    width: 100%;
    padding: 8px 9px;
    border-radius: 7px;
    color: var(--text-dim);
    font-size: 12.5px;
    text-align: left;
  }

  .net-menu button:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .profile {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    margin-left: 0;
    flex-shrink: 0;
    border: 1px solid var(--stroke);
    border-radius: 50%;
    color: var(--text-dim);
    background:
      radial-gradient(circle at 34% 28%, rgba(255, 255, 255, 0.16), transparent 62%),
      var(--glass);
    -webkit-app-region: no-drag;
    transition:
      border-color var(--speed) var(--ease),
      color var(--speed) var(--ease),
      background var(--speed) var(--ease);
  }

  .profile:hover {
    border-color: var(--stroke-strong);
    color: var(--text);
    background:
      radial-gradient(circle at 34% 28%, rgba(255, 255, 255, 0.22), transparent 62%),
      var(--glass-hover);
  }

  .profile-note {
    position: absolute;
    top: calc(100% + 8px);
    right: 16px;
    z-index: 60;
    padding: 8px 11px;
    border: 1px solid var(--stroke);
    border-radius: 9px;
    background: var(--glass-strong);
    backdrop-filter: blur(26px) saturate(150%);
    -webkit-backdrop-filter: blur(26px) saturate(150%);
    color: var(--text-dim);
    font-size: 11.5px;
    box-shadow: var(--shadow-dock);
    pointer-events: none;
    -webkit-app-region: no-drag;
    animation: note-in 130ms var(--ease);
  }

  @keyframes note-in {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
  }

  .sidebar {
    grid-column: 1;
    grid-row: 2;
    position: relative;
    z-index: 20;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 14px 0;
    min-height: 0;
    overflow: visible;
    background: var(--glass);
    backdrop-filter: blur(26px) saturate(150%);
    -webkit-backdrop-filter: blur(26px) saturate(150%);
    border-right: 1px solid var(--stroke);
  }

  nav {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .nav {
    position: relative;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 10px;
    color: var(--text-dim);
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .nav:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .nav:disabled {
    cursor: default;
    color: var(--text-faint);
  }

  .nav:disabled:hover {
    background: transparent;
    color: var(--text-faint);
  }

  .nav.on {
    background: var(--glass-active);
    color: var(--text);
  }

  /* The label doubles as the hover/focus tooltip. It stays in the DOM (and in
     the button's text for tests), but is only painted when the icon is active. */
  .nav-label {
    position: absolute;
    top: 50%;
    left: calc(100% + 12px);
    z-index: 5;
    padding: 6px 9px;
    border: 1px solid var(--stroke);
    border-radius: 7px;
    background: var(--glass-strong);
    backdrop-filter: blur(26px) saturate(150%);
    -webkit-backdrop-filter: blur(26px) saturate(150%);
    box-shadow: var(--shadow-dock);
    color: var(--text);
    font-size: 12px;
    font-weight: 500;
    line-height: 1.2;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transform: translate(-4px, -50%);
    transition:
      opacity 120ms var(--ease),
      transform 120ms var(--ease);
  }

  .nav:hover .nav-label {
    opacity: 1;
    transform: translate(0, -50%);
    transition-delay: 120ms;
  }

  .nav:focus-visible .nav-label {
    opacity: 1;
    transform: translate(0, -50%);
    transition-delay: 0ms;
  }

  .update-dot {
    position: absolute;
    top: 7px;
    right: 7px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text);
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.12);
  }

  .content {
    /* Artist banners bleed through these to the titlebar and window edges. */
    --content-x: 26px;
    --content-y: 20px;
    grid-column: 2;
    grid-row: 2;
    min-height: 0;
    padding: var(--content-y) var(--content-x) 10px;
  }

  .offline-page {
    max-width: 560px;
    padding: 48px 0;
  }

  .eyebrow {
    margin: 0 0 10px;
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .offline-page h1 {
    margin: 0 0 10px;
    font-size: clamp(24px, 3vw, 34px);
    letter-spacing: -0.035em;
  }

  .offline-page > p:not(.eyebrow) {
    margin: 0;
    max-width: 460px;
    color: var(--text-dim);
    font-size: 14px;
    line-height: 1.55;
  }

  .offline-actions {
    display: flex;
    gap: 8px;
    margin-top: 20px;
  }

  .primary {
    height: 34px;
    padding: 0 15px;
    border-radius: 999px;
    background: var(--accent);
    color: #08080b;
    font-size: 12.5px;
    font-weight: 600;
  }

  .primary:hover {
    background: var(--accent-strong);
  }

  .alerts {
    position: fixed;
    left: 50%;
    bottom: calc(var(--player-h) + 18px);
    z-index: 65;
    width: min(540px, calc(100vw - 48px));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    transform: translateX(-50%);
    pointer-events: none;
  }

  .alerts > * {
    pointer-events: auto;
  }

  .toast {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 15px;
    border: 1px solid var(--stroke-strong);
    border-radius: 999px;
    background: var(--glass-strong);
    backdrop-filter: blur(24px) saturate(150%);
    -webkit-backdrop-filter: blur(24px) saturate(150%);
    box-shadow: var(--shadow-dock);
    color: var(--text);
    font-size: 12.5px;
    font-weight: 550;
    animation: toast-in 180ms var(--ease);
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }

  .alert-card {
    width: 100%;
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    align-items: start;
    gap: 12px;
    padding: 12px 12px 12px 14px;
    border: 1px solid rgba(255, 128, 128, 0.22);
    border-radius: 14px;
    background: #17171d;
    box-shadow:
      0 18px 48px rgba(0, 0, 0, 0.5),
      inset 2px 0 0 rgba(255, 128, 128, 0.68),
      inset 0 1px 0 rgba(255, 255, 255, 0.04);
    animation: alert-in 180ms var(--ease);
  }

  .alert-mark {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 9px;
    background: rgba(255, 128, 128, 0.1);
    color: var(--danger);
  }

  .alert-copy {
    min-width: 0;
    padding-top: 2px;
  }

  .alert-copy strong {
    color: var(--text);
    font-size: 12.5px;
    font-weight: 600;
  }

  .alert-copy p {
    margin: 3px 0 0;
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    user-select: text;
  }

  .alert-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .alert-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: 58px;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--stroke);
    border-radius: 7px;
    color: var(--text-dim);
    font-size: 10.5px;
    font-weight: 550;
    transition:
      color var(--speed) var(--ease),
      border-color var(--speed) var(--ease),
      background var(--speed) var(--ease);
  }

  .alert-action:hover {
    border-color: var(--stroke-strong);
    background: var(--glass-hover);
    color: var(--text);
  }

  .alert-close {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 7px;
    color: var(--text-dim);
    transition:
      color var(--speed) var(--ease),
      background var(--speed) var(--ease);
  }

  .alert-close:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .sr-alert {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  @keyframes alert-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .alert-card {
      animation: none;
    }
  }
</style>
