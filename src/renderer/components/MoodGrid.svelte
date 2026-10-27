<script lang="ts">
  import { onMount } from 'svelte'
  import { nav } from '../lib/nav.svelte'
  import { moods } from '../lib/moods.svelte'
  import Icon from './Icon.svelte'

  type Card = {
    title: string
    subtitle: string
    /** YouTube Music's own tile title; the card label may differ. */
    category: string
    icon: 'brain' | 'bolt' | 'moon' | 'disc'
    motion: 'focus' | 'energy' | 'night' | 'throwback'
  }

  const CARDS: Card[] = [
    {
      title: 'Focus',
      subtitle: 'Lo-fi & instrumentals',
      category: 'Focus',
      icon: 'brain',
      motion: 'focus'
    },
    { title: 'Energy', subtitle: 'Turn it up', category: 'Energize', icon: 'bolt', motion: 'energy' },
    {
      title: 'Late night',
      subtitle: 'After-hours R&B',
      category: 'Chill',
      icon: 'moon',
      motion: 'night'
    },
    {
      title: 'Throwbacks',
      subtitle: 'Back to the 2000s',
      category: 'Decades',
      icon: 'disc',
      motion: 'throwback'
    }
  ]

  onMount(() => {
    void moods.load()
  })

  async function open(card: Card): Promise<void> {
    // A click before the tiles land should wait for them rather than do nothing.
    if (moods.categories.length === 0) await moods.load()
    const params = moods.paramsFor(card.category)
    if (params) nav.openMood({ title: card.title, params })
  }
</script>

<section class="moods" aria-label="Browse by mood">
  <header>
    <h2>Start something</h2>
    <p>A few directions for whatever comes next.</p>
  </header>

  <div class="mood-grid">
    {#each CARDS as card, i (card.title)}
      <button
        class="mood"
        data-motion={card.motion}
        style="--i: {i}"
        aria-label={`Explore ${card.title}`}
        title={`Open YouTube Music's ${card.category}`}
        onclick={() => void open(card)}
      >
        <span class="mood-icon" aria-hidden="true"><Icon name={card.icon} size={20} /></span>
        <span class="mood-copy">
          <strong>{card.title}</strong>
          <span>{card.subtitle}</span>
        </span>
        <span class="mood-arrow" aria-hidden="true"><Icon name="forward" size={13} /></span>
      </button>
    {/each}
  </div>

  {#if moods.error}
    <p class="mood-error">
      Moods are unavailable right now.
      <button title={moods.error} onclick={() => void moods.load(true)}>Retry</button>
    </p>
  {/if}
</section>

<style>
  .moods {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.012em;
  }

  header p {
    margin: 0;
    color: var(--text-faint);
    font-size: 11px;
  }

  .mood-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }

  .mood {
    display: flex;
    align-items: center;
    gap: 11px;
    min-width: 0;
    padding: 12px;
    border: 1px solid var(--stroke);
    border-radius: var(--radius);
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.032), rgba(255, 255, 255, 0.008));
    color: var(--text-dim);
    text-align: left;
    animation: mood-in 300ms var(--ease) both;
    animation-delay: calc(var(--i) * 45ms);
    transition:
      transform var(--speed) var(--ease),
      border-color var(--speed) var(--ease),
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .mood:hover,
  .mood:focus-visible {
    transform: translateY(-2px);
    border-color: var(--stroke-strong);
    background: var(--glass-hover);
    color: var(--text);
  }

  /* The icon carries the mood; there is no borrowed artwork any more. */
  .mood-icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    flex-shrink: 0;
    border: 1px solid var(--stroke);
    border-radius: 11px;
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.01));
    color: var(--text-dim);
    transition:
      color var(--speed) var(--ease),
      border-color var(--speed) var(--ease),
      box-shadow var(--speed) var(--ease);
  }

  .mood:hover .mood-icon,
  .mood:focus-visible .mood-icon {
    color: var(--text);
    border-color: var(--stroke-strong);
    box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.028);
  }

  .mood[data-motion='focus']:hover .mood-icon :global(svg),
  .mood[data-motion='focus']:focus-visible .mood-icon :global(svg) {
    animation: mood-pulse 1.9s var(--ease) infinite;
  }

  .mood[data-motion='energy']:hover .mood-icon :global(svg),
  .mood[data-motion='energy']:focus-visible .mood-icon :global(svg) {
    animation: mood-flicker 900ms steps(2, end) infinite;
  }

  .mood[data-motion='night']:hover .mood-icon :global(svg),
  .mood[data-motion='night']:focus-visible .mood-icon :global(svg) {
    animation: mood-rock 3.2s var(--ease) infinite;
  }

  .mood[data-motion='throwback']:hover .mood-icon :global(svg),
  .mood[data-motion='throwback']:focus-visible .mood-icon :global(svg) {
    animation: mood-spin 3.2s linear infinite;
  }

  @keyframes mood-pulse {
    0%,
    100% {
      transform: scale(1);
      opacity: 0.82;
    }
    50% {
      transform: scale(1.12);
      opacity: 1;
    }
  }

  @keyframes mood-flicker {
    0%,
    100% {
      opacity: 1;
    }
    35% {
      opacity: 0.32;
    }
    50% {
      opacity: 1;
    }
    65% {
      opacity: 0.55;
    }
  }

  @keyframes mood-rock {
    0%,
    100% {
      transform: rotate(-7deg);
    }
    50% {
      transform: rotate(7deg);
    }
  }

  @keyframes mood-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .mood-copy {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .mood-copy strong {
    color: var(--text);
    font-size: 12.5px;
    font-weight: 580;
    letter-spacing: -0.01em;
  }

  .mood-copy span {
    overflow: hidden;
    color: var(--text-faint);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mood-arrow {
    display: grid;
    place-items: center;
    color: var(--text-faint);
    transition:
      color var(--speed) var(--ease),
      transform var(--speed) var(--ease);
  }

  .mood:hover .mood-arrow,
  .mood:focus-visible .mood-arrow {
    color: var(--text);
    transform: translateX(2px);
  }

  .mood-error {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    color: var(--text-faint);
    font-size: 11.5px;
  }

  .mood-error button {
    color: var(--text-dim);
    font-size: 11.5px;
    padding: 2px 9px;
    border: 1px solid var(--stroke);
    border-radius: 999px;
  }

  .mood-error button:hover {
    color: var(--text);
    background: var(--glass-hover);
  }

  @keyframes mood-in {
    from {
      opacity: 0;
      transform: translateY(5px);
    }
  }

  @media (max-width: 1050px) {
    .mood-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .mood {
      animation: none;
    }

    .mood:hover .mood-icon :global(svg),
    .mood:focus-visible .mood-icon :global(svg) {
      animation: none;
    }
  }
</style>
