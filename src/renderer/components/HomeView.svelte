<script lang="ts">
  import type { CatalogItem } from '@shared/types'
  import type { ListeningSummary, RecentGroup } from '@shared/listening'
  import { groupRecentHistory } from '@shared/listening'
  import { api } from '../lib/api'
  import { isPlayable, player } from '../lib/player.svelte'
  import { nav } from '../lib/nav.svelte'
  import { homeShelves } from '../lib/catalog-cache.svelte'
  import { fitRail } from '../lib/rail-fit'
  import MediaCard from './MediaCard.svelte'
  import InlineAlert from './InlineAlert.svelte'
  import ListeningDashboard from './ListeningDashboard.svelte'
  import MoodGrid from './MoodGrid.svelte'

  // Shelves live in a store so leaving Home (or visiting a page) does not
  // refetch and flash a loading state every time.
  const page = homeShelves

  let recentGroups = $state<RecentGroup[]>([])
  let summary = $state<ListeningSummary | null>(null)
  let recentRequest = 0

  const moodArt = $derived([
    ...recentGroups.map((group) => group.thumbnail),
    ...page.shelves.flatMap((shelf) => shelf.items.map((item) => item.thumbnail))
  ])

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
    const request = ++recentRequest
    try {
      const [history, weekly] = await Promise.all([api.history.list(40), api.history.summary()])
      // The track changed again while this request was in flight.
      if (request !== recentRequest) return
      recentGroups = groupRecentHistory(history, 4, 2)
      summary = weekly
      player.prefetchList(recentGroups.flatMap((group) => group.tracks), 2)
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

  {#if summary && recentGroups.length > 0}
    <ListeningDashboard groups={recentGroups} {summary} />
  {/if}

  <MoodGrid art={moodArt} />

  {#each page.shelves as shelf, si (shelf.title + si)}
    <section class="shelf">
      <h2>{shelf.title || 'More'}</h2>
      <div class="rail" use:fitRail>
        {#each shelf.items as item (item.kind + item.id + item.title)}
          <MediaCard {item} onActivate={(x) => activate(shelf.items, x)} />
        {/each}
      </div>
    </section>
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

  .shelf {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  h2 {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    letter-spacing: -0.012em;
  }

  .rail {
    display: flex;
    gap: 18px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 2px 4px 8px;
    margin: -2px -4px 0;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
  }

  .rail::-webkit-scrollbar {
    height: 8px;
  }

  .rail::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 999px;
  }

  .placeholder {
    color: var(--text-faint);
    font-size: 13px;
  }
</style>
