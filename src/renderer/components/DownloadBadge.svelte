<script lang="ts">
  import type { DownloadMark } from '../lib/library-items'
  import Icon from './Icon.svelte'

  let {
    mark,
    progress = 0,
    size = 22
  }: {
    mark: DownloadMark
    /** 0–100 for the partial ring. */
    progress?: number
    size?: number
  } = $props()

  const label = $derived(
    mark === 'full'
      ? 'Downloaded'
      : mark === 'partial'
        ? `${Math.round(progress)}% downloaded`
        : ''
  )
</script>

{#if mark !== 'none'}
  <span
    class="badge"
    class:full={mark === 'full'}
    class:partial={mark === 'partial'}
    style="--size:{size}px; --p:{Math.max(0, Math.min(100, progress))}"
    title={label}
    aria-label={label}
    role="img"
  >
    <Icon name={mark === 'full' ? 'check' : 'download'} size={Math.round(size * 0.52)} />
  </span>
{/if}

<style>
  .badge {
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    display: grid;
    place-items: center;
    position: relative;
    flex: none;
  }

  .full {
    background: var(--text);
    color: #08080b;
    box-shadow:
      0 0 0 2px rgba(8, 8, 11, 0.72),
      0 2px 8px rgba(0, 0, 0, 0.45);
  }

  .partial {
    background: conic-gradient(var(--text) calc(var(--p) * 1%), rgba(255, 255, 255, 0.18) 0);
    color: var(--text);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
  }

  .partial::before {
    content: '';
    position: absolute;
    inset: 2px;
    border-radius: 50%;
    background: #121216;
  }

  .partial :global(svg) {
    position: relative;
    z-index: 1;
  }
</style>
