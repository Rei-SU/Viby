<script lang="ts">
  import { player } from '../lib/player.svelte'
  import { downloads } from '../lib/downloads.svelte'
  import { openArtist } from '../lib/artist'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'

  function fmt(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return '—'
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }
</script>

<section class="queue">
  <header>
    <h1>Queue</h1>
    <span class="count">{player.queue.length}</span>
    {#if player.queue.length > 0}
      <button class="clear" onclick={() => player.clearQueue()}>Clear</button>
    {/if}
  </header>

  {#if player.queue.length === 0}
    <p class="empty">Nothing queued. Play something from Home or Search and it lines up here.</p>
  {:else}
    <ul class="scroll">
      {#each player.queue as track, i (track.id + '-' + i)}
        <li class:current={i === player.index}>
          <div
            class="row"
            role="button"
            tabindex="0"
            onclick={() => player.playAt(i)}
            onkeydown={(event) => {
              if (event.target !== event.currentTarget) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                player.playAt(i)
              }
            }}
          >
            <span class="idx tabular">
              {#if i === player.index && player.playing}
                <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
              {:else}
                {i + 1}
              {/if}
            </span>
            <Cover src={track.thumbnail} size={38} radius={6} alt={track.title} />
            <span class="text">
              <span class="t truncate">{track.title}</span>
              <span class="a truncate">
                {#if track.artistId}
                  <button
                    class="artist-link"
                    onclick={(event) => {
                      event.stopPropagation()
                      openArtist(track.artistId, track.artist)
                    }}>{track.artist}</button
                  >
                {:else}
                  {track.artist}
                {/if}
              </span>
            </span>
            {#if downloads.stateFor(track.id) === 'done'}
              <span class="dl-badge" title="Downloaded">
                <Icon name="check" size={11} /> Downloaded
              </span>
            {:else if downloads.stateFor(track.id) === 'downloading' ||
              downloads.stateFor(track.id) === 'queued'}
              <span class="dl-badge busy" title="Downloading…">Downloading</span>
            {/if}
            <span class="len tabular">{fmt(track.durationSec)}</span>
          </div>
          <button class="remove" title="Remove" aria-label="Remove from queue" onclick={() => player.removeAt(i)}>
            <Icon name="close" size={14} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <label class="autoplay">
    <input type="checkbox" checked={player.autoplay} onchange={() => player.toggleAutoplay()} />
    <span>Autoplay similar songs when the queue ends</span>
  </label>
</section>

<style>
  .queue {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    gap: 12px;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 4px 2px 0;
  }

  h1 {
    font-size: 28px;
    font-weight: 640;
    margin: 0;
    letter-spacing: -0.028em;
  }

  .count {
    color: var(--text-faint);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .clear {
    margin-left: auto;
    color: var(--text-dim);
    font-size: 12px;
    padding: 5px 11px;
    border-radius: 999px;
    border: 1px solid var(--stroke);
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .clear:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .empty {
    color: var(--text-faint);
    font-size: 13px;
    padding: 6px 2px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    min-height: 0;
    flex: 1;
  }

  li {
    display: flex;
    align-items: center;
    border-radius: 10px;
    transition: background var(--speed) var(--ease);
  }

  li:hover {
    background: var(--glass-hover);
  }

  li.current {
    background: var(--glass-active);
  }

  .row {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 7px 10px;
    min-width: 0;
    text-align: left;
  }

  .idx {
    width: 18px;
    color: var(--text-faint);
    font-size: 11.5px;
    text-align: right;
    display: grid;
    place-items: center;
  }

  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
    gap: 1px;
  }

  .t {
    font-size: 13.5px;
    font-weight: 480;
  }

  li.current .t {
    color: var(--text);
  }

  .a {
    font-size: 12px;
    color: var(--text-faint);
  }

  .artist-link {
    color: inherit;
    padding: 0;
    font: inherit;
  }

  .artist-link:hover {
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .len {
    color: var(--text-faint);
    font-size: 11.5px;
  }

  .dl-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    padding: 3px 8px;
    border: 1px solid var(--stroke);
    border-radius: 999px;
    color: var(--text-dim);
    font-size: 10.5px;
  }

  .dl-badge.busy {
    color: #f0c477;
    border-color: rgba(240, 196, 119, 0.26);
  }

  .remove {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-right: 6px;
    border-radius: 7px;
    color: var(--text-faint);
    opacity: 0;
    transition:
      opacity var(--speed) var(--ease),
      color var(--speed) var(--ease),
      background var(--speed) var(--ease);
  }

  li:hover .remove,
  li:focus-within .remove,
  .remove:focus-visible {
    opacity: 1;
  }

  .remove:hover {
    color: var(--danger);
    background: var(--glass-hover);
  }

  .autoplay {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 2px 2px;
    border-top: 1px solid var(--stroke);
    font-size: 12.5px;
    color: var(--text-dim);
    cursor: pointer;
  }

  .autoplay input {
    accent-color: var(--accent);
    cursor: pointer;
  }

  .eq {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: 11px;
  }

  .eq i {
    width: 2px;
    border-radius: 1px;
    background: var(--accent);
    animation: bounce 900ms ease-in-out infinite;
  }

  .eq i:nth-child(1) {
    height: 5px;
    animation-delay: -200ms;
  }

  .eq i:nth-child(2) {
    height: 11px;
    animation-delay: -500ms;
  }

  .eq i:nth-child(3) {
    height: 7px;
    animation-delay: -100ms;
  }

  @keyframes bounce {
    0%,
    100% {
      transform: scaleY(0.4);
    }
    50% {
      transform: scaleY(1);
    }
  }
</style>
