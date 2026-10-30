<script lang="ts">
  import type { CatalogItem } from '@shared/types'
  import { openTrackFromItem } from '../lib/release'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'
  import SubtitleParts from './SubtitleParts.svelte'

  let {
    item,
    onActivate,
    size = 152
  }: {
    item: CatalogItem
    onActivate: (item: CatalogItem) => void
    size?: number
  } = $props()

  const action = $derived(item.kind === 'song' ? `Play ${item.title}` : `Open ${item.title}`)
</script>

<div class="card" style="--card-size: {size}px">
  <button
    type="button"
    class="card-hit"
    aria-label={action}
    title={item.title}
    onclick={() => onActivate(item)}
  ></button>
  <span class="art" aria-hidden="true">
    <Cover
      src={item.thumbnail}
      {size}
      radius={item.kind === 'artist' ? '50%' : 12}
      fluid
      alt={item.title}
    />
    <span class="play-badge"><Icon name="play" size={14} solid /></span>
  </span>
  {#if item.kind === 'song'}
    <button
      type="button"
      class="card-title truncate"
      title={item.album ? `Open ${item.album}` : `Open ${item.title}`}
      onclick={(event) => {
        event.stopPropagation()
        openTrackFromItem(item)
      }}
    >
      {item.title}
    </button>
  {:else}
    <span class="card-title truncate" aria-hidden="true">{item.title}</span>
  {/if}
  <span class="card-sub truncate">
    <SubtitleParts parts={item.parts} fallback={item.subtitle} />
  </span>
</div>

<style>
  .card {
    /* Rails write --rail-card-width so every visible card is whole. Cards
       outside a rail keep the fixed --card-size they were given. */
    position: relative;
    width: var(--rail-card-width, var(--card-size, 152px));
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex-shrink: 0;
    text-align: left;
  }

  /* The hit target is a real button underneath the artwork and title. Names in
     the subtitle sit above it and handle their own clicks. */
  .card-hit {
    position: absolute;
    inset: 0;
    z-index: 0;
    border-radius: 12px;
  }

  .card > :not(.card-hit) {
    position: relative;
    z-index: 1;
    pointer-events: none;
  }

  .art {
    position: relative;
    display: block;
    border-radius: 12px;
    overflow: hidden;
    transition:
      transform var(--speed) var(--ease),
      box-shadow var(--speed) var(--ease);
  }

  .card:hover .art {
    transform: translateY(-3px);
    box-shadow: var(--shadow-card);
  }

  .play-badge {
    position: absolute;
    right: 11px;
    bottom: 11px;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: #08080b;
    background: var(--text);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.45);
    opacity: 0;
    transform: translateY(6px);
    transition:
      opacity var(--speed) var(--ease),
      transform var(--speed) var(--ease);
  }

  .card:hover .play-badge {
    opacity: 1;
    transform: translateY(0);
  }

  .card:hover .art :global(img) {
    filter: brightness(0.82);
  }

  .card-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    margin-top: 4px;
  }

  button.card-title {
    display: block;
    align-self: flex-start;
    max-width: 100%;
    padding: 0;
    border: 0;
    background: none;
    font-family: inherit;
    text-align: left;
  }

  /* The card is a play target; its title opens the song. */
  .card > button.card-title {
    pointer-events: auto;
  }

  button.card-title:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .card-sub {
    font-size: 11.5px;
    color: var(--text-faint);
  }
</style>
