<script lang="ts">
  import type { Snippet } from 'svelte'
  import { fitRail } from '../lib/rail-fit'
  import Icon from './Icon.svelte'

  let {
    title = '',
    action,
    header,
    children
  }: {
    title?: string
    /** Extra header content (Show all, See all) placed before the chevrons. */
    action?: Snippet
    /** A fully custom header row (e.g. discography tabs); chevrons still follow. */
    header?: Snippet
    children: Snippet
  } = $props()

  let railEl = $state<HTMLDivElement | undefined>(undefined)
  let overflow = $state(false)
  let atStart = $state(true)
  let atEnd = $state(true)

  $effect(() => {
    const rail = railEl
    if (!rail) return

    const update = (): void => {
      const max = rail.scrollWidth - rail.clientWidth
      overflow = max > 1
      atStart = rail.scrollLeft <= 1
      atEnd = rail.scrollLeft >= max - 1
    }

    rail.addEventListener('scroll', update, { passive: true })
    const resize = new ResizeObserver(update)
    resize.observe(rail)
    const mutations = new MutationObserver(update)
    mutations.observe(rail, { childList: true })
    update()

    return () => {
      rail.removeEventListener('scroll', update)
      resize.disconnect()
      mutations.disconnect()
    }
  })

  function page(direction: 1 | -1): void {
    const rail = railEl
    if (!rail) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    rail.scrollBy({
      left: direction * Math.max(160, rail.clientWidth * 0.85),
      behavior: reduced ? 'auto' : 'smooth'
    })
  }
</script>

<section class="shelf">
  <div class="head">
    <div class="head-main">
      {#if header}
        {@render header()}
      {:else}
        <h2>{title}</h2>
        {#if action}<span class="action">{@render action()}</span>{/if}
      {/if}
    </div>

    {#if overflow}
      <div class="navs">
        <button
          type="button"
          class="nav prev"
          aria-label="Scroll left"
          title="Scroll left"
          disabled={atStart}
          onclick={() => page(-1)}
        >
          <Icon name="back" size={16} />
        </button>
        <button
          type="button"
          class="nav next"
          aria-label="Scroll right"
          title="Scroll right"
          disabled={atEnd}
          onclick={() => page(1)}
        >
          <Icon name="forward" size={16} />
        </button>
      </div>
    {/if}
  </div>

  <div class="rail" use:fitRail bind:this={railEl}>
    {@render children()}
  </div>
</section>

<style>
  .shelf {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 28px;
  }

  .head-main {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.012em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .action {
    display: flex;
    flex-shrink: 0;
    align-items: center;
  }

  /* Two bare chevrons at the end of the shelf header; they stay visible so
     the carousel reads as scrollable without hunting for a hover target. A
     shelf with nothing to scroll renders no controls at all. */
  .navs {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 2px;
  }

  .nav {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    color: var(--text);
    transition:
      color var(--speed) var(--ease),
      background var(--speed) var(--ease);
  }

  .nav:hover:not(:disabled) {
    background: var(--glass-hover);
  }

  .nav:disabled {
    opacity: 0.28;
    cursor: default;
  }

  .rail {
    display: flex;
    gap: 18px;
    min-width: 0;
    padding: 2px 4px 8px;
    margin: -2px -4px 0;
    overflow-x: auto;
    overflow-y: hidden;
  }
</style>
