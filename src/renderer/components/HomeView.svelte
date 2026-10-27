<script lang="ts">
  import type { CatalogItem } from '@shared/types'
  import type { ListeningSummary } from '@shared/listening'
  import { historyItem } from '@shared/listening'
  import { api } from '../lib/api'
  import { isPlayable, player } from '../lib/player.svelte'
  import { nav } from '../lib/nav.svelte'
  import { homeShelves } from '../lib/catalog-cache.svelte'
  import { history } from '../lib/history.svelte'
  import MediaCard from './MediaCard.svelte'
  import Rail from './Rail.svelte'
  import InlineAlert from './InlineAlert.svelte'
  import ListeningDashboard from './ListeningDashboard.svelte'
  import MoodGrid from './MoodGrid.svelte'

  // Shelves live in a store so leaving Home (or visiting a page) does not
  // refetch and flash a loading state every time.
  const page = homeShelves

  let summary = $state<ListeningSummary | null>(null)
  let summaryRequest = 0

  // The card is a snapshot of what you have been playing, so repeats collapse;
  // the panel is the full play log and keeps every entry.
  const recentItems = $derived.by(() => {
    const seen = new Set<string>()
    const rows: CatalogItem[] = []
    for (const entry of history.entries) {
      if (seen.has(entry.trackId)) continue
      seen.add(entry.trackId)
      rows.push(historyItem(entry))
      if (rows.length === 5) break
    }
    return rows
  })

  $effect(() => {
    if (!page.attempted && !page.loading) void load()
  })

  async function load(): Promise<void> {
    page.attempted = true
    page.loading = true
    page.error = null

    try {
      const res = await api.catalog.home()
      if (res.ok) {
        page.shelves = res.data.filter((s) => s.items.length > 0)
        player.prefetchList(page.shelves[0]?.items ?? [], 2)
      } else {
        page.error = res.error
        page.shelves = []
      }
    } catch (err) {
      page.error = err instanceof Error ? err.message : String(err)
      page.shelves = []
    } finally {
      page.loading = false
    }
  }

  async function loadRecent(): Promise<void> {
    const request = ++summaryRequest
    try {
      const [, weekly] = await Promise.all([history.load(true), api.history.summary()])
      // The track changed again while this request was in flight.
      if (request !== summaryRequest) return
      summary = weekly
      player.prefetchList(recentItems, 2)
    } catch {
      // Listening context is a convenience; a failed read leaves the old list.
    }
  }

  $effect(() => {
    void player.current?.id
    void loadRecent()
  })

  /** Curated collections (a shelf, a mix) play as a queue. */
  function play(items: CatalogItem[], item: CatalogItem): void {
    const playable = items.filter(isPlayable)
    const index = playable.findIndex((i) => i.id === item.id)
    void player.playList(playable, Math.max(0, index))
  }

  function activate(items: CatalogItem[], item: CatalogItem): void {
    if (isPlayable(item)) play(items, item)
    else nav.open(item)
  }
</script>

<div class="view">
  <header class="head">
    <h1>Home</h1>
    <p>Your listening, at a glance.</p>
  </header>

  {#if page.error}
    <InlineAlert
      title="Could not load Home"
      message={page.error}
      actionLabel="Retry"
      onAction={() => void load()}
    />
  {/if}

  {#if page.loading && page.shelves.length === 0}
    <p class="placeholder">Loading…</p>
  {/if}

  {#if summary}
    <ListeningDashboard items={recentItems} {summary} />
  {/if}

  <MoodGrid />

  {#each page.shelves as shelf, si (shelf.title + si)}
    <Rail title={shelf.title || 'More'}>
      {#each shelf.items as item (item.kind + item.id + item.title)}
        <MediaCard {item} onActivate={(x) => activate(shelf.items, x)} />
      {/each}
    </Rail>
  {/each}
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 30px;
    padding-bottom: 16px;
  }

  .head {
    padding-top: 4px;
  }

  .head h1 {
    font-size: 30px;
    font-weight: 640;
    margin: 0 0 3px;
    letter-spacing: -0.028em;
  }

  .head p {
    margin: 0;
    color: var(--text-faint);
    font-size: 12.5px;
  }

  .placeholder {
    color: var(--text-faint);
    font-size: 13px;
  }
</style>
