<script lang="ts">
  import { onMount } from 'svelte'
  import { nav, type View } from './lib/nav.svelte'
  import { player } from './lib/player.svelte'
  import { api } from './lib/api'
  import PlayerBar from './components/PlayerBar.svelte'
  import HomeView from './components/HomeView.svelte'
  import SearchView from './components/SearchView.svelte'
  import DetailView from './components/DetailView.svelte'
  import TrackView from './components/TrackView.svelte'
  import LibraryView from './components/LibraryView.svelte'
  import CollectionView from './components/CollectionView.svelte'
  import PlaylistPicker from './components/PlaylistPicker.svelte'
  import LyricsPanel from './components/LyricsPanel.svelte'
  import { lyrics } from './lib/lyrics.svelte'
  import ImportView from './components/ImportView.svelte'
  import SettingsView from './components/SettingsView.svelte'
  import Queue from './components/Queue.svelte'
  import Icon from './components/Icon.svelte'

  const navItems: {
    id: View
    label: string
    icon: 'home' | 'chart' | 'search' | 'disc' | 'list' | 'download' | 'gear'
  }[] = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'charts', label: 'Charts', icon: 'chart' },
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'library', label: 'Library', icon: 'disc' },
    { id: 'queue', label: 'Queue', icon: 'list' },
    { id: 'import', label: 'Import', icon: 'download' },
    { id: 'settings', label: 'Settings', icon: 'gear' }
  ]

  const isMac = api.platform === 'darwin'

  let collapsed = $state(localStorage.getItem('viby.sidebar') === 'collapsed')

  function toggleSidebar(): void {
    collapsed = !collapsed
    localStorage.setItem('viby.sidebar', collapsed ? 'collapsed' : 'expanded')
  }

  // Remember where you were scrolled in each view, so Back feels like Back.
  let main: HTMLElement | undefined
  const scrollMemory = new Map<string, number>()
  let scrollKey = ''

  function viewKey(): string {
    if (nav.track) return `track:${nav.track.id}`
    if (nav.detail) return `detail:${nav.detail.id}`
    if (nav.collection) {
      return nav.collection.kind === 'liked'
        ? 'collection:liked'
        : `collection:${nav.collection.id}`
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
    void player.init()
  })
</script>

<div class="layout" class:collapsed>
  <!-- The window has no native title bar on macOS, so this strip is the only
       draggable area. Everything interactive inside it must opt out. -->
  <header class="titlebar" class:mac={isMac}>
    <button
      class="chrome-btn"
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      onclick={toggleSidebar}
    >
      <Icon name="sidebar" size={16} />
    </button>
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
    {#if !collapsed}
      <span class="tagline">Listen without the noise</span>
    {/if}
  </header>

  <aside class="sidebar">
    <nav>
      {#each navItems as item (item.id)}
        <button
          class="nav"
          class:on={nav.view === item.id && !nav.detail && !nav.track && !nav.collection}
          title={item.label}
          onclick={() => nav.go(item.id)}
        >
          <Icon name={item.icon} size={17} />
          <span>{item.label}</span>
        </button>
      {/each}
    </nav>

    {#if !collapsed}
      <div class="sidebar-foot">
        <span class="rule"></span>
        <p>No ads. No account.<br />Nothing to sign up for.</p>
      </div>
    {/if}
  </aside>

  <main class="content scroll" bind:this={main} onscroll={onScroll}>
    {#if player.error}
      <div class="notice">
        <div class="notice-text">
          <strong>Playback problem</strong>
          <span>{player.error}</span>
        </div>
        <button class="notice-close" onclick={() => (player.error = null)} aria-label="Dismiss">
          <Icon name="close" size={15} />
        </button>
      </div>
    {/if}

    {#if nav.track}
      <TrackView track={nav.track} />
    {:else if nav.detail}
      <DetailView item={nav.detail} />
    {:else if nav.collection}
      <CollectionView ref={nav.collection} />
    {:else if nav.view === 'home'}
      <HomeView source="home" />
    {:else if nav.view === 'charts'}
      <HomeView source="charts" />
    {:else if nav.view === 'search'}
      <SearchView />
    {:else if nav.view === 'library'}
      <LibraryView />
    {:else if nav.view === 'queue'}
      <Queue />
    {:else if nav.view === 'settings'}
      <SettingsView />
    {:else}
      <ImportView />
    {/if}
  </main>

  <PlayerBar />
  <PlaylistPicker />
  <LyricsPanel />
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
    grid-template-rows: var(--titlebar-h) minmax(0, 1fr) var(--player-h);
    height: 100vh;
    transition: grid-template-columns 220ms var(--ease);
  }

  .layout.collapsed {
    --sidebar-w: 66px;
  }

  .titlebar {
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

  .tagline {
    font-size: 11.5px;
    color: var(--text-faint);
    letter-spacing: 0.01em;
  }

  .sidebar {
    grid-column: 1;
    grid-row: 2;
    display: flex;
    flex-direction: column;
    padding: 10px 8px;
    min-height: 0;
    overflow: hidden;
    background: var(--glass);
    backdrop-filter: blur(26px) saturate(150%);
    -webkit-backdrop-filter: blur(26px) saturate(150%);
    border-right: 1px solid var(--stroke);
  }

  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .nav {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 9px 11px;
    border-radius: 8px;
    color: var(--text-dim);
    font-size: 13.5px;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .nav:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .nav.on {
    background: var(--glass-active);
    color: var(--text);
    font-weight: 500;
  }

  .nav.on :global(svg) {
    color: var(--text);
  }

  .collapsed .nav {
    justify-content: center;
    padding: 10px 0;
    gap: 0;
  }

  .collapsed .nav span {
    display: none;
  }

  .sidebar-foot {
    margin-top: auto;
    padding: 12px 11px 4px;
  }

  .rule {
    display: block;
    height: 1px;
    background: var(--stroke);
    margin-bottom: 12px;
  }

  .sidebar-foot p {
    margin: 0;
    font-size: 11px;
    line-height: 1.55;
    color: var(--text-faint);
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

  .notice {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    border-radius: var(--radius-lg);
    padding: 11px 14px;
    font-size: 13px;
    border: 1px solid rgba(255, 128, 128, 0.28);
    background: rgba(255, 128, 128, 0.08);
    margin-bottom: 18px;
  }

  .notice-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .notice strong {
    font-weight: 550;
  }

  .notice span {
    color: var(--text-dim);
  }

  .notice-close {
    color: var(--text-dim);
    padding: 2px;
    border-radius: 6px;
    flex-shrink: 0;
  }

  .notice-close:hover {
    color: var(--text);
    background: var(--glass-hover);
  }
</style>
