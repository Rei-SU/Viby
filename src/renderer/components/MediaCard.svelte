<script lang="ts">
  import type { CatalogItem } from '@shared/types'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'

  let {
    item,
    onActivate,
    size = 152
  }: {
    item: CatalogItem
    onActivate: (item: CatalogItem) => void
    size?: number
  } = $props()
</script>

<button class="card" style="--card-size: {size}px" onclick={() => onActivate(item)} title={item.title}>
  <span class="art">
    <Cover
      src={item.thumbnail}
      {size}
      radius={item.kind === 'artist' ? '50%' : 12}
      fluid
      alt={item.title}
    />
    <span class="play-badge"><Icon name="play" size={14} solid /></span>
  </span>
  <span class="card-title truncate">{item.title}</span>
  <span class="card-sub truncate">{item.subtitle}</span>
</button>

<style>
  .card {
    /* Rails write --rail-card-width so every visible card is whole. Cards
       outside a rail keep the fixed --card-size they were given. */
    width: var(--rail-card-width, var(--card-size, 152px));
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex-shrink: 0;
    text-align: left;
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

  .card-sub {
    font-size: 11.5px;
    color: var(--text-faint);
  }
</style>
