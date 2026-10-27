<script lang="ts">
  import { onMount } from 'svelte'
  import { historyItem } from '@shared/listening'
  import { history } from '../lib/history.svelte'
  import TrackRow from './TrackRow.svelte'

  onMount(() => {
    void history.load(true)
  })
</script>

<div class="history scroll">
  {#if history.entries.length === 0}
    <p class="empty">
      {history.loading
        ? 'Loading history…'
        : 'No listening history yet. Play something and it lands here.'}
    </p>
  {:else}
    <ul class="rows">
      {#each history.entries as entry, i (entry.trackId + '-' + entry.playedAt + '-' + i)}
        <TrackRow item={historyItem(entry)} showFavorite />
      {/each}
    </ul>
  {/if}
</div>

<style>
  .history {
    flex: 1;
    min-height: 0;
    padding: 2px 8px 14px;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .empty {
    margin: 0;
    padding: 8px 14px;
    color: var(--text-faint);
    font-size: 13px;
    line-height: 1.5;
  }
</style>
