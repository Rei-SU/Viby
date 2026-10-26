<script lang="ts">
  import { nav } from '../lib/nav.svelte'
  import { searchState } from '../lib/search.svelte'
  import { artwork } from '../lib/artwork.svelte'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'

  let { art }: { art: Array<string | undefined> } = $props()

  const MOODS = [
    { title: 'Focus', subtitle: 'Lo-fi & instrumentals', query: 'lofi instrumental focus', artIndex: 0 },
    { title: 'Energy', subtitle: 'Turn it up', query: 'workout hits', artIndex: 3 },
    { title: 'Late night', subtitle: 'After-hours R&B', query: 'late night r&b chill', artIndex: 6 },
    { title: 'Throwbacks', subtitle: 'Back to the 2000s', query: '2000s hits', artIndex: 9 }
  ]

  const moods = $derived(
    MOODS.map((mood) => ({
      ...mood,
      thumbnail: art.length > 0 ? art[mood.artIndex % art.length] : undefined
    }))
  )

  function openMood(query: string): void {
    searchState.setQuery(query)
    searchState.submit('all')
    nav.go('search')
  }
</script>

<section class="moods" aria-label="Browse by mood">
  <header>
    <h2>Start something</h2>
    <p>A few directions for whatever comes next.</p>
  </header>

  <div class="mood-grid">
    {#each moods as mood, i (mood.title)}
      <button class="mood" style="--i: {i}" aria-label={`Explore ${mood.title}`} onclick={() => openMood(mood.query)}>
        <Cover src={artwork.src(mood.thumbnail)} size={48} radius={11} alt="" />
        <span class="mood-copy">
          <strong>{mood.title}</strong>
          <span>{mood.subtitle}</span>
        </span>
        <span class="mood-arrow" aria-hidden="true"><Icon name="forward" size={13} /></span>
      </button>
    {/each}
  </div>
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
  }
</style>
