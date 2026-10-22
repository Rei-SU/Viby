<script lang="ts">
  import type { CatalogItem } from '@shared/types'
  import { api } from '../lib/api'
  import { nav } from '../lib/nav.svelte'
  import { player } from '../lib/player.svelte'
  import { searchState } from '../lib/search.svelte'
  import { network } from '../lib/network.svelte'
  import { openArtist } from '../lib/artist'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'

  type QuickGroupId = 'songs' | 'artists' | 'playlists'
  type QuickGroups = Record<QuickGroupId, CatalogItem[]>

  type GroupDef = {
    id: QuickGroupId
    label: string
    filter: 'songs' | 'artists' | 'playlists'
    kind: 'song' | 'artist' | 'playlist'
  }

  type Group = GroupDef & { items: CatalogItem[]; offset: number }

  type Option =
    | { type: 'result'; item: CatalogItem }
    | { type: 'recent'; query: string }

  const GROUP_DEFS: GroupDef[] = [
    { id: 'songs', label: 'Songs', filter: 'songs', kind: 'song' },
    { id: 'artists', label: 'Artists', filter: 'artists', kind: 'artist' },
    { id: 'playlists', label: 'Playlists', filter: 'playlists', kind: 'playlist' }
  ]

  const QUICK_LIMIT = 5
  const MAX_RECENTS = 6
  const RECENT_KEY = 'viby.recentSearches'
  const isMac = api.platform === 'darwin'
  const shortcut = isMac ? '⌘K' : 'Ctrl K'

  let wrapper: HTMLDivElement | undefined = $state()
  let panel: HTMLDivElement | undefined = $state()
  let input: HTMLInputElement | undefined = $state()

  let open = $state(false)
  let active = $state(-1)

  let quick = $state<QuickGroups>(emptyQuick())
  let quickFor = $state('')
  let loading = $state<Record<QuickGroupId, boolean>>({
    songs: false,
    artists: false,
    playlists: false
  })
  let quickError = $state<string | null>(null)

  let recents = $state<string[]>(loadRecents())

  let timer: ReturnType<typeof setTimeout> | null = null
  let seq = 0
  const cache = new Map<string, QuickGroups>()
  let wasLocalFirst = network.localFirst

  function emptyQuick(): QuickGroups {
    return { songs: [], artists: [], playlists: [] }
  }

  function cloneQuick(groups: QuickGroups): QuickGroups {
    return {
      songs: [...groups.songs],
      artists: [...groups.artists],
      playlists: [...groups.playlists]
    }
  }

  function loadRecents(): string[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
      if (!Array.isArray(parsed)) return []
      return parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENTS)
    } catch {
      return []
    }
  }

  function saveRecents(): void {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recents))
    } catch {
      // A full or unavailable store should never break search.
    }
  }

  function remember(query: string): void {
    const value = query.trim()
    if (!value) return
    const lower = value.toLowerCase()
    recents = [value, ...recents.filter((item) => item.toLowerCase() !== lower)].slice(0, MAX_RECENTS)
    saveRecents()
  }

  function cacheKey(query: string): string {
    return query.trim().toLowerCase()
  }

  function isSearchPage(): boolean {
    return nav.view === 'search' && !nav.detail && !nav.track && !nav.collection
  }

  /**
   * The palette mounts straight under `<body>`. Inside the titlebar it sits
   * beneath the header's own `backdrop-filter`, which mangles the panel's
   * backdrop sampling (the glass reads far lighter than the lyrics panel with
   * identical values). Outside that filter context the same tint and blur
   * render exactly like the lyrics panel.
   */
  function portal(node: HTMLDivElement): { destroy: () => void } {
    document.body.appendChild(node)
    return {
      destroy: () => node.remove()
    }
  }

  function close(): void {
    open = false
    active = -1
  }

  function resetQuick(): void {
    seq += 1
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    quick = emptyQuick()
    quickFor = ''
    loading = { songs: false, artists: false, playlists: false }
    quickError = null
  }

  function scheduleQuick(raw: string, immediate = false): void {
    const query = raw.trim()
    if (!query || network.localFirst) {
      resetQuick()
      return
    }

    if (timer) {
      clearTimeout(timer)
      timer = null
    }

    const key = cacheKey(query)
    const cached = cache.get(key)
    if (cached) {
      seq += 1
      quick = cloneQuick(cached)
      quickFor = query
      loading = { songs: false, artists: false, playlists: false }
      quickError = null
      return
    }

    // Do not restart a request that is already in flight for this query.
    if (
      quickFor === query &&
      (loading.songs || loading.artists || loading.playlists)
    ) {
      return
    }

    if (quickFor !== query) {
      quick = emptyQuick()
      quickError = null
    }
    quickFor = query
    loading = { songs: true, artists: true, playlists: true }
    timer = setTimeout(() => void fetchQuick(query), immediate ? 0 : 170)
  }

  async function fetchQuick(query: string): Promise<void> {
    timer = null
    if (network.localFirst) {
      resetQuick()
      return
    }
    const mine = ++seq
    let left = GROUP_DEFS.length
    let failures = 0
    let firstError: string | null = null

    const finish = (id: QuickGroupId, data: CatalogItem[] | null, error?: string): void => {
      if (mine !== seq) return
      if (data) {
        const def = GROUP_DEFS.find((group) => group.id === id)
        const items = def
          ? data.filter((item) => item.kind === def.kind).slice(0, QUICK_LIMIT)
          : []
        quick = { ...quick, [id]: items }
      } else {
        failures += 1
        firstError ??= error ?? 'Search failed'
      }
      loading = { ...loading, [id]: false }

      if (--left > 0) return
      if (failures === GROUP_DEFS.length) {
        quickError = firstError
        return
      }

      const snapshot = cloneQuick(quick)
      cache.set(cacheKey(query), snapshot)
      if (cache.size > 12) {
        const oldest = cache.keys().next().value
        if (oldest) cache.delete(oldest)
      }
    }

    for (const def of GROUP_DEFS) {
      void api.catalog
        .search(query, def.filter)
        .then((result) => finish(def.id, result.ok ? result.data : null, result.ok ? undefined : result.error))
        .catch((error: unknown) => finish(def.id, null, String(error)))
    }
  }

  const groups = $derived.by((): Group[] => {
    const query = searchState.query.trim()
    if (network.localFirst || !query || quickFor !== query) return []

    let offset = 0
    const next: Group[] = []
    for (const def of GROUP_DEFS) {
      const items = quick[def.id]
      if (items.length === 0) continue
      next.push({ ...def, items, offset })
      offset += items.length
    }
    return next
  })

  const options = $derived.by((): Option[] => {
    if (!searchState.query.trim()) {
      return recents.map((query): Option => ({ type: 'recent', query }))
    }
    return groups.flatMap((group) =>
      group.items.map((item): Option => ({ type: 'result', item }))
    )
  })

  const isQuickLoading = $derived(loading.songs || loading.artists || loading.playlists)
  const activeId = $derived(
    active >= 0 && active < options.length ? `viby-quick-${active}` : undefined
  )

  $effect(() => {
    // A navigation from anywhere else (Back, a sidebar tab, opening a result)
    // should not leave the palette hanging over the new page.
    nav.view
    nav.detail
    nav.track
    nav.collection
    close()
  })

  $effect(() => {
    // Results are cached by query, so an online result would otherwise stay
    // visible after going offline. Drop the cache and close the palette.
    const local = network.localFirst
    if (local === wasLocalFirst) return
    wasLocalFirst = local
    resetQuick()
    close()
  })

  $effect(() => {
    if (active >= options.length) active = -1
  })

  $effect(() => {
    const id = activeId
    if (!id) return
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'nearest' })
    })
  })

  function onInput(event: Event): void {
    if (network.localFirst) return
    const value = (event.currentTarget as HTMLInputElement).value
    searchState.setQuery(value)
    open = true
    active = -1
    scheduleQuick(value)
  }

  function onFocus(): void {
    if (network.localFirst) return
    open = true
    active = -1
    const query = searchState.query.trim()
    if (query && quickFor !== query) scheduleQuick(query, true)
  }

  function onInputClick(): void {
    if (network.localFirst) return
    // Escape can close the panel without moving focus; a second click should
    // bring the suggestions back.
    if (open) return
    open = true
    active = -1
    const query = searchState.query.trim()
    if (query && quickFor !== query) scheduleQuick(query, true)
  }

  function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null
    // The panel is portaled outside the wrapper, so both containers count as
    // "inside" the search surface.
    if (next && (wrapper?.contains(next) || panel?.contains(next))) return
    close()
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (!open) return
    const target = event.target as Node | null
    if (!target || (!wrapper?.contains(target) && !panel?.contains(target))) close()
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (network.localFirst) return
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
    event.preventDefault()
    input?.focus()
    input?.select()
    open = true
    active = -1
    const query = searchState.query.trim()
    if (query && quickFor !== query) scheduleQuick(query, true)
  }

  function move(delta: number): void {
    open = true
    if (options.length === 0) {
      active = -1
      return
    }
    if (active < 0) {
      active = delta > 0 ? 0 : options.length - 1
      return
    }
    active = (active + delta + options.length) % options.length
  }

  function commit(): void {
    if (network.localFirst) return
    const query = searchState.query.trim()
    if (!query) return
    remember(query)

    const inSearch = nav.view === 'search'
    searchState.submit(inSearch ? undefined : 'all')
    close()
    if (!isSearchPage()) nav.go('search')
    input?.focus()
  }

  function useRecent(query: string): void {
    if (network.localFirst) return
    searchState.setQuery(query)
    searchState.submit('all')
    remember(query)
    close()
    if (!isSearchPage()) nav.go('search')
    input?.blur()
  }

  function showMore(group: Group): void {
    if (network.localFirst) return
    const query = searchState.query.trim()
    if (!query) return
    remember(query)
    searchState.submit(group.filter)
    close()
    if (!isSearchPage()) nav.go('search')
    input?.blur()
  }

  function choose(option: Option): void {
    if (network.localFirst) return
    if (option.type === 'recent') {
      useRecent(option.query)
      return
    }

    const query = searchState.query.trim()
    if (query) remember(query)
    close()

    const item = option.item
    if (item.kind === 'song') {
      // YouTube Music behaviour: a search result plays on its own; what comes
      // next is the radio extension seeded from this track — never the rows
      // around it in the results list.
      void player.playItem(item)
    } else if (item.kind === 'artist') {
      openArtist(item.id, item.title, item.thumbnail)
    } else {
      nav.open(item)
    }
    input?.blur()
  }

  function onInputKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return

    if (event.key === 'Escape') {
      event.preventDefault()
      if (open) close()
      else input?.blur()
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      move(1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(-1)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const option = options[active]
      if (option) choose(option)
      else commit()
    }
  }

  function clear(): void {
    searchState.setQuery('')
    resetQuick()
    active = -1
    if (network.localFirst) {
      close()
      return
    }
    open = true
    input?.focus()
  }

  function clearRecents(): void {
    recents = []
    saveRecents()
    input?.focus()
  }

  function fmt(seconds?: number): string {
    if (!seconds) return ''
    const minutes = Math.floor(seconds / 60)
    const rest = Math.floor(seconds % 60)
    return `${minutes}:${rest.toString().padStart(2, '0')}`
  }
</script>

<svelte:window onkeydown={onWindowKeydown} onpointerdown={onWindowPointerDown} />

<div class="search-wrap" bind:this={wrapper} onfocusout={onFocusOut}>
  <div class="searchbox" class:open class:disabled={network.localFirst}>
    <Icon name="search" size={15} />
    <input
      bind:this={input}
      type="text"
      value={searchState.query}
      oninput={onInput}
      onfocus={onFocus}
      onclick={onInputClick}
      onkeydown={onInputKeydown}
      placeholder={network.localFirst
        ? 'You are not connected to the internet'
        : 'Search songs, artists, playlists…'}
      spellcheck="false"
      autocomplete="off"
      disabled={network.localFirst}
      role="combobox"
      aria-label="Search"
      aria-expanded={open}
      aria-controls="viby-quick-search"
      aria-autocomplete="list"
      aria-activedescendant={activeId}
    />
    <div class="trail">
      {#if isQuickLoading}
        <span class="pip" aria-hidden="true"></span>
      {/if}
      {#if searchState.query}
        <button class="clear" aria-label="Clear search" title="Clear search" onclick={clear}>
          <Icon name="close" size={12} />
        </button>
      {:else if !open && !network.localFirst}
        <kbd>{shortcut}</kbd>
      {/if}
    </div>
  </div>

  <div class="quick-panel" class:open={open} bind:this={panel} use:portal>
      <div
        class="quick-list scroll"
        id="viby-quick-search"
        tabindex="-1"
        role="listbox"
        aria-label="Search suggestions"
        onpointerdown={(event) => event.preventDefault()}
      >
        {#if !searchState.query.trim()}
          <div class="section-head">
            <span>Recent searches</span>
            {#if recents.length > 0}
              <button class="text-button" onclick={clearRecents}>Clear</button>
            {/if}
          </div>

          {#if recents.length === 0}
            <div class="quick-empty">
              <span class="empty-icon"><Icon name="search" size={18} /></span>
              <span>
                <strong>Search Viby</strong>
                <small>Songs, artists and playlists — without leaving the page.</small>
              </span>
            </div>
          {:else}
            {#each recents as query, i (query)}
              <button
                class="quick-row recent"
                class:active={active === i}
                id={`viby-quick-${i}`}
                role="option"
                aria-selected={active === i}
                onpointerenter={() => (active = i)}
                onclick={() => useRecent(query)}
              >
                <span class="recent-icon"><Icon name="clock" size={15} /></span>
                <span class="row-text">
                  <span class="row-title truncate">{query}</span>
                </span>
                <Icon name="forward" size={13} />
              </button>
            {/each}
          {/if}
        {:else}
          {#if groups.length > 0}
            {#each groups as group (group.id)}
              <div class="quick-section" data-group={group.id} role="group" aria-label={group.label}>
                <div class="section-head">
                  <span>{group.label}</span>
                  <button class="text-button show-more" onclick={() => showMore(group)}>
                    Show more
                    <Icon name="forward" size={11} />
                  </button>
                </div>

                {#each group.items as item, i (item.id)}
                  {@const index = group.offset + i}
                  <button
                    class="quick-row"
                    class:active={active === index}
                    id={`viby-quick-${index}`}
                    data-kind={item.kind}
                    role="option"
                    aria-selected={active === index}
                    onpointerenter={() => (active = index)}
                    onclick={() => choose({ type: 'result', item })}
                  >
                    <Cover
                      src={item.thumbnail}
                      size={32}
                      radius={item.kind === 'artist' ? 16 : 5}
                      alt={item.title}
                    />
                    <span class="row-text">
                      <span class="row-title truncate">{item.title}</span>
                      <span class="row-sub truncate">{item.subtitle}</span>
                    </span>
                    {#if item.kind === 'song' && item.durationSec}
                      <span class="row-dur tabular">{fmt(item.durationSec)}</span>
                    {:else}
                      <Icon name="forward" size={13} />
                    {/if}
                  </button>
                {/each}
              </div>
            {/each}
          {:else if isQuickLoading}
            <div class="quick-status">
              <span class="pip" aria-hidden="true"></span>
              Searching…
            </div>
          {:else if quickError}
            <div class="quick-status error">
              <Icon name="close" size={14} />
              <span>Search failed — {quickError}</span>
            </div>
          {:else}
            <div class="quick-status">No results for “{searchState.query.trim()}”.</div>
          {/if}
        {/if}
      </div>

      {#if searchState.query.trim()}
        <div class="quick-foot">
          <button class="all-results" onclick={commit}>
            All results
            <Icon name="forward" size={12} />
          </button>
          <span class="key-hint">
            <kbd>↑</kbd><kbd>↓</kbd>
            navigate
            <span class="dot">·</span>
            <kbd>↵</kbd>
            {active >= 0 ? 'open' : 'all results'}
            <span class="dot">·</span>
            <kbd>esc</kbd>
          </span>
        </div>
      {/if}
    </div>
</div>

<style>
  .search-wrap {
    position: relative;
    width: 100%;
    -webkit-app-region: no-drag;
  }

  .searchbox {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 9px;
    border: 1px solid var(--stroke);
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.045);
    color: var(--text-faint);
    transition:
      border-color var(--speed) var(--ease),
      background var(--speed) var(--ease),
      box-shadow var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .searchbox:focus-within,
  .searchbox.open {
    border-color: var(--stroke-strong);
    background: rgba(255, 255, 255, 0.07);
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.035);
    color: var(--text-dim);
  }

  .searchbox input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font-size: 12.5px;
  }

  .searchbox input:focus-visible {
    outline: none;
  }

  .searchbox input::placeholder {
    color: var(--text-faint);
  }

  .searchbox.disabled {
    opacity: 0.72;
  }

  .searchbox.disabled input {
    cursor: default;
  }

  .trail {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  kbd {
    font: inherit;
    font-size: 10px;
    line-height: 1;
    padding: 3px 5px;
    border: 1px solid var(--stroke);
    border-radius: 4px;
    color: var(--text-faint);
    background: rgba(255, 255, 255, 0.03);
    white-space: nowrap;
  }

  .clear {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    color: var(--text-faint);
    background: var(--glass-hover);
    transition:
      color var(--speed) var(--ease),
      background var(--speed) var(--ease);
  }

  .clear:hover {
    color: var(--text);
    background: var(--glass-active);
  }

  .pip {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 1;
    }
  }

  .quick-panel {
    /* Fixed to the window: the search bar is always centered, so the palette
       hangs from a constant offset. (It is portaled to <body>; see `portal`.) */
    position: fixed;
    top: calc(var(--titlebar-h) + 2px);
    left: 50%;
    display: flex;
    flex-direction: column;
    width: min(560px, calc(100vw - 32px));
    max-height: calc(100vh - var(--titlebar-h) - var(--player-h) - 56px);
    transform: translate(-50%, -4px) scale(0.995);
    opacity: 0;
    pointer-events: none;
    visibility: hidden;
    overflow: hidden;
    border: 1px solid var(--stroke);
    border-radius: 14px;
    background: rgba(11, 11, 15, 0.78);
    backdrop-filter: blur(32px) saturate(150%);
    -webkit-backdrop-filter: blur(32px) saturate(150%);
    box-shadow: var(--shadow-dock);
    z-index: 60;
    -webkit-app-region: no-drag;
    transform-origin: top center;
    transition:
      transform 300ms var(--ease),
      opacity 300ms linear,
      visibility 0s linear 300ms;
  }

  .quick-panel.open {
    transform: translate(-50%, 0) scale(1);
    opacity: 1;
    pointer-events: auto;
    visibility: visible;
    transition:
      transform 300ms var(--ease),
      opacity 220ms var(--ease),
      visibility 0s;
  }

  .quick-list {
    flex: 1 1 auto;
    min-height: 0;
    padding: 6px;
    overscroll-behavior: contain;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 8px 5px;
    font-size: 10px;
    font-weight: 550;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .text-button {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10.5px;
    font-weight: 450;
    letter-spacing: 0;
    text-transform: none;
    color: var(--text-dim);
    transition: color var(--speed) var(--ease);
  }

  .text-button:hover {
    color: var(--text);
  }

  .show-more {
    padding: 2px 1px 2px 6px;
  }

  .quick-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 5px 8px;
    border-radius: 8px;
    text-align: left;
    color: var(--text-dim);
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .quick-row:hover,
  .quick-row.active {
    background: var(--glass-hover);
    color: var(--text);
  }

  .quick-row.active {
    background: var(--glass-active);
  }

  .recent {
    color: var(--text-dim);
  }

  .recent-icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    color: var(--text-faint);
  }

  .row-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
    gap: 1px;
  }

  .row-title {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text);
  }

  .row-sub {
    font-size: 11.5px;
    color: var(--text-faint);
  }

  .row-dur {
    font-size: 11px;
    color: var(--text-faint);
    padding-left: 6px;
  }

  .quick-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 18px 12px 20px;
    color: var(--text-faint);
    font-size: 12.5px;
  }

  .quick-status.error {
    color: var(--danger);
  }

  .quick-empty {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 12px 10px 16px;
  }

  .empty-icon {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    background: var(--glass-hover);
    color: var(--text-faint);
    flex-shrink: 0;
  }

  .quick-empty > span:last-child {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .quick-empty strong {
    font-size: 12.5px;
    font-weight: 550;
    color: var(--text-dim);
  }

  .quick-empty small {
    font-size: 11.5px;
    color: var(--text-faint);
  }

  .quick-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-shrink: 0;
    padding: 7px 14px 8px;
    border-top: 1px solid var(--stroke);
  }

  .all-results {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11.5px;
    color: var(--text-dim);
    transition: color var(--speed) var(--ease);
  }

  .all-results:hover {
    color: var(--text);
  }

  .key-hint {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    color: var(--text-faint);
    white-space: nowrap;
  }

  .key-hint kbd {
    font-size: 9.5px;
    padding: 2px 4px;
  }

  .dot {
    margin: 0 1px;
  }

  @media (max-width: 980px) {
    .quick-panel {
      width: min(520px, calc(100vw - 24px));
    }
  }
</style>
