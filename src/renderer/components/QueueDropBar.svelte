<script lang="ts">
  import { player } from '../lib/player.svelte'
  import { trackDrag } from '../lib/track-drag.svelte'
  import { toast } from '../lib/toast.svelte'
  import Icon from './Icon.svelte'

  /**
   * The always-available drop target. The queue button is a 30px target in the
   * corner and the panel may be closed, so while a row is in the air this bar
   * rises above the player: a big, obvious "add to queue" surface.
   */
  let over = $state(false)

  function onDragOver(event: DragEvent): void {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    over = true
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault()
    over = false
    const item = trackDrag.item
    if (!item) return
    player.enqueue(item)
    toast.show(`Added ${item.title} to queue`)
  }
</script>

<!-- The row's own dragend normally clears the store; this catches the cases
     where the source row unmounted or the drag ended outside the window. -->
<svelte:window ondragend={() => trackDrag.end()} />

{#if trackDrag.active && trackDrag.item}
  <div
    class="drop-bar"
    class:over
    role="presentation"
    ondragover={onDragOver}
    ondragleave={() => (over = false)}
    ondrop={onDrop}
  >
    <span class="mark" aria-hidden="true"><Icon name="queueAdd" size={15} /></span>
    <span class="copy">
      <strong>Drop to add to queue</strong>
      <span class="title truncate">{trackDrag.item.title}</span>
    </span>
  </div>
{/if}

<style>
  .drop-bar {
    position: fixed;
    left: 50%;
    bottom: calc(var(--player-h) + 18px);
    z-index: 66;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(420px, calc(100vw - 48px));
    padding: 8px 18px 8px 10px;
    border: 1px dashed var(--stroke-strong);
    border-radius: 999px;
    background: var(--glass-strong);
    backdrop-filter: blur(24px) saturate(150%);
    -webkit-backdrop-filter: blur(24px) saturate(150%);
    box-shadow: var(--shadow-dock);
    transform: translateX(-50%);
    pointer-events: auto;
    animation: bar-in 160ms var(--ease);
  }

  /* The pointer is over the bar: the target is live. */
  .drop-bar.over {
    border-style: solid;
    border-color: var(--text);
    background: var(--glass-active);
  }

  .mark {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: 999px;
    background: var(--glass-hover);
    color: var(--text);
  }

  .copy {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .copy strong {
    color: var(--text);
    font-size: 12.5px;
    font-weight: 600;
    white-space: nowrap;
  }

  .title {
    color: var(--text-faint);
    font-size: 10.5px;
  }

  @keyframes bar-in {
    from {
      opacity: 0;
      translate: 0 8px;
    }
    to {
      opacity: 1;
      translate: 0 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .drop-bar {
      animation: none;
    }
  }
</style>
