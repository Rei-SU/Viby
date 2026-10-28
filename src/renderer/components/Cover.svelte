<script lang="ts">
  import { artwork } from '../lib/artwork.svelte'
  import Icon from './Icon.svelte'

  let {
    src,
    size = 44,
    radius = 6,
    alt = '',
    fluid = false
  }: { src?: string; size?: number; radius?: number | string; alt?: string; fluid?: boolean } = $props()

  const radiusCss = $derived(typeof radius === 'number' ? `${radius}px` : radius)
  const coverStyle = $derived(
    fluid
      ? `border-radius:${radiusCss}`
      : `width:${size}px;height:${size}px;border-radius:${radiusCss}`
  )

  /**
   * A dead URL should look like missing art, not a broken browser.
   *
   * This used to be `failed = $state(false)` plus an `$effect` that reset it when
   * `src` changed. That effect wrote state which the error handler also wrote, and
   * with a failing image the two could ping-pong forever — freezing the renderer
   * (Svelte's effect flush spinning). Deriving it from the URL removes the effect
   * entirely, so there is no cycle to get into.
   */
  let failedSrc = $state<string | null>(null)
  const showImage = $derived(Boolean(src) && failedSrc !== src)
</script>

{#if showImage}
  <img
    class="cover"
    class:fluid
    {src}
    {alt}
    draggable="false"
    loading="lazy"
    decoding="async"
    onerror={() => {
      failedSrc = src ?? ''
      if (src) artwork.broken(src)
      console.warn('[cover] image failed:', src)
    }}
    style={coverStyle}
  />
{:else}
  <div class="cover empty" class:fluid style={coverStyle}>
    <Icon name="note" size={Math.max(14, Math.round(size * 0.32))} />
  </div>
{/if}

<style>
  .cover {
    object-fit: cover;
    background: rgba(255, 255, 255, 0.04);
    flex-shrink: 0;
    display: block;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
  }

  /* Card artwork follows the fitted card width instead of a frozen pixel size. */
  .cover.fluid {
    width: 100%;
    height: auto;
    aspect-ratio: 1;
  }

  .empty {
    display: grid;
    place-items: center;
    color: rgba(255, 255, 255, 0.18);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
    background: linear-gradient(145deg, #17171d, #202028);
  }
</style>
