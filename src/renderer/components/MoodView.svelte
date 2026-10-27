<script lang="ts">
  import type { BrowseResult, CatalogItem } from '@shared/types'
  import { api } from '../lib/api'
  import { moods } from '../lib/moods.svelte'
  import { nav, type MoodRef } from '../lib/nav.svelte'
  import { isPlayable, player } from '../lib/player.svelte'
  import { fitRail } from '../lib/rail-fit'
  import MediaCard from './MediaCard.svelte'
  import InlineAlert from './InlineAlert.svelte'

  let { mood }: { mood: MoodRef } = $props()

  let result = $state<BrowseResult | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)
  let request = 0

  $effect(() => {
    const ref = mood
    void load(ref)
  })

  async function load(ref: MoodRef): Promise<void> {
    const cached = moods.cached(ref.params)
    if (cached) {
      result = cached
      error = null
      loading = false
      return
    }

    const token = ++request
    loading = true
    error = null
    result = null
    try {
      const res = await api.catalog.browse('FEmusic_moods_and_genres_category', ref.params)
      if (token !== request) return
      if (res.ok) {
        result = res.data
        moods.remember(ref.params, res.data)
      } else {
        error = res.error
      }
    } catch (err) {
      if (token === request) error = err instanceof Error ? err.message : String(err)
    } finally {
      if (token === request) loading = false
    }
  }

  function activate(item: CatalogItem): void {
    if (isPlayable(item)) void player.playList([item], 0)
    else nav.open(item)
  }

  const shelves = $derived(result?.shelves ?? [])
</script>

<div class="view mood-view">
  <header class="head">
    <span class="eyebrow">Mood</span>
    <h1>{mood.title}</h1>
    <p>Playlists YouTube Music picked for this mood.</p>
  </header>

  {#if loading && !result}
    <p class="placeholder">Loading playlists…</p>
  {/if}

  {#if error}
    <InlineAlert
      title="Could not open this mood"
      message={error}
      actionLabel="Retry"
      onAction={() => void load(mood)}
    />
  {/if}

  {#if result && shelves.length === 0}
    <p class="placeholder">No playlists in this mood right now.</p>
  {/if}

  {#each shelves as shelf, si (shelf.title + si)}
    <section class="shelf">
      <h2>{shelf.title || 'More'}</h2>
      <div class="rail" use:fitRail>
        {#each shelf.items as item (item.kind + item.id + item.title)}
          <MediaCard {item} onActivate={activate} />
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 28px;
    padding-bottom: 16px;
  }

  .head {
    padding-top: 4px;
  }

  .eyebrow {
    color: var(--text-faint);
    font-size: 10.5px;
    font-weight: 550;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .head h1 {
    margin: 4px 0 3px;
    font-size: 30px;
    font-weight: 640;
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
    margin: 0;
    font-size: 15px;
    font-weight: 600;
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
