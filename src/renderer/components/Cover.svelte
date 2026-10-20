<script lang="ts">
  import Icon from './Icon.svelte'

  let {
    src,
    size = 44,
    radius = 6,
    alt = ''
  }: { src?: string; size?: number; radius?: number; alt?: string } = $props()

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
    {src}
    {alt}
    loading="lazy"
    decoding="async"
    onerror={() => {
      failedSrc = src ?? ''
      console.warn('[cover] image failed:', src)
    }}
    style="width:{size}px;height:{size}px;border-radius:{radius}px"
  />
{:else}
  <div class="cover empty" style="width:{size}px;height:{size}px;border-radius:{radius}px">
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

  .empty {
    display: grid;
    place-items: center;
    color: rgba(255, 255, 255, 0.18);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
    background: linear-gradient(145deg, #17171d, #202028);
  }
</style>
