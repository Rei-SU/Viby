<script lang="ts">
  import type { CatalogItem, HistoryEntry } from '@shared/types'
  import { api } from '../lib/api'
  import { isPlayable, player } from '../lib/player.svelte'
  import { nav } from '../lib/nav.svelte'
  import { shelfStates } from '../lib/catalog-cache.svelte'
  import MediaCard from './MediaCard.svelte'

  let { source }: { source: 'home' | 'charts' } = $props()

  // Shelves live in a store so switching tabs (or visiting a page) does not
  // refetch and flash a loading state every time.
  const page = $derived(shelfStates[source])

  let recent = $state<CatalogItem[]>([])

  $effect(() => {
    if (!page.attempted && !page.loading) void load(source)
  })

  async function load(which: 'home' | 'charts'): Promise<void> {
    const target = shelfStates[which]
    target.attempted = true
    target.loading = true
    target.error = null

    const res = which === 'home' ? await api.catalog.home() : await api.catalog.charts()
    if (res.ok) {
      target.shelves = res.data.filter((s) => s.items.length > 0)
      player.prefetchList(target.shelves[0]?.items ?? [], 2)
    } else {
      target.error = res.error
      target.shelves = []
    }
    target.loading = false
  }

  async function loadRecent(): Promise<void> {
    const list = await api.history.list(24)
    const seen = new Set<string>()
    recent = list
      .filter((h: HistoryEntry) => {
        if (seen.has(h.trackId)) return false
        seen.add(h.trackId)
        return true
      })
      .map((h: HistoryEntry) => ({
        id: h.trackId,
        kind: 'song' as const,
        title: h.title,
        subtitle: h.artist,
        thumbnail: h.thumbnail,
        artists: h.artist ? [h.artist] : undefined,
        parts: h.artist ? [{ text: h.artist, artistId: h.artistId }] : undefined
      }))

    player.prefetchList(recent, 2)
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

  /**
   * History is not a playlist. Playing something from Recently played starts that
   * single song; when it ends, autoplay follows the radio for it.
   */
  function playOne(item: CatalogItem): void {
    void player.playList([item], 0)
  }

  function activate(items: CatalogItem[], item: CatalogItem): void {
    if (isPlayable(item)) play(items, item)
    else nav.open(item)
  }
</script>

<div class="view">
  <header class="head">
    <h1>{source === 'home' ? 'Home' : 'Charts'}</h1>
    <p>Global — no region setup, no sign-in required.</p>
  </header>

  {#if page.error}
    <div class="notice">
      <div>
        <strong>Could not load {source}</strong>
        <span>{page.error}</span>
      </div>
      <button class="link" onclick={() => load(source)}>Retry</button>
    </div>
  {/if}

  {#if page.loading && page.shelves.length === 0}
    <p class="placeholder">Loading…</p>
  {/if}

  {#if source === 'home' && recent.length > 0}
    <section class="shelf">
      <h2>Recently played</h2>
      <div class="rail">
        {#each recent as item (item.id)}
          <MediaCard {item} onActivate={playOne} />
        {/each}
      </div>
    </section>
  {/if}

  {#each page.shelves as shelf, si (shelf.title + si)}
    <section class="shelf">
      <h2>{shelf.title || 'More'}</h2>
      <div class="rail">
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

  .notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    border-radius: var(--radius-lg);
    padding: 11px 14px;
    font-size: 13px;
    border: 1px solid rgba(255, 128, 128, 0.28);
    background: rgba(255, 128, 128, 0.08);
  }

  .notice div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .notice span {
    color: var(--text-dim);
    font-size: 12.5px;
  }

  .link {
    color: var(--accent);
    font-size: 12px;
    flex-shrink: 0;
  }
</style>
