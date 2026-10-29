<script lang="ts">
  import { onDestroy } from 'svelte'
  import { downloads } from '../lib/downloads.svelte'
  import { sidePanel } from '../lib/side-panel.svelte'

  const HOLD_MS = 1800
  const EXIT_MS = 260

  const jobs = $derived(Object.values(downloads.jobs))
  const activeCount = $derived(
    jobs.filter((job) => job.state === 'downloading' || job.state === 'queued' || job.state === 'paused')
      .length
  )
  const failedCount = $derived(jobs.filter((job) => job.state === 'failed').length)
  const pendingCount = $derived(jobs.length)
  const downloading = $derived(jobs.some((job) => job.state === 'downloading'))

  // Success is a transient beat: the queue drains, the glyph becomes a check,
  // then the button leaves. Failures stay until the queue is acted on.
  let heldSuccess = $state(false)
  let exiting = $state(false)
  let shakeKey = $state(0)
  let timers: ReturnType<typeof setTimeout>[] = []

  const mode = $derived<'active' | 'failed' | 'success' | 'idle'>(
    activeCount > 0 ? 'active' : failedCount > 0 ? 'failed' : heldSuccess ? 'success' : 'idle'
  )

  let seeded = false
  let prevActive = 0
  let prevEntries = 0
  let prevFailed = new Set<string>()

  $effect(() => {
    const entries = downloads.entries.length
    const active = activeCount
    const failed = failedCount

    if (!seeded) {
      seeded = true
      prevActive = active
      prevEntries = entries
      prevFailed = new Set(jobs.filter((job) => job.state === 'failed').map((job) => job.trackId))
      return
    }

    // Only a queue that actually finished earns the check. Cancelling or
    // clearing also empties the queue, but it does not add entries.
    if (prevActive > 0 && active === 0 && failed === 0 && entries > prevEntries) {
      holdSuccess()
    }

    const failedIds = new Set(
      jobs.filter((job) => job.state === 'failed').map((job) => job.trackId)
    )
    if ([...failedIds].some((id) => !prevFailed.has(id))) shakeKey += 1

    prevActive = active
    prevEntries = entries
    prevFailed = failedIds
  })

  // Work arriving (or failing) during the success beat cancels its timers, so
  // the button cannot fade out while it has something new to say.
  $effect(() => {
    if ((activeCount > 0 || failedCount > 0) && (heldSuccess || exiting)) {
      clearTimers()
      heldSuccess = false
      exiting = false
    }
  })

  function holdSuccess(): void {
    clearTimers()
    exiting = false
    heldSuccess = true
    timers.push(setTimeout(() => (exiting = true), HOLD_MS))
    timers.push(
      setTimeout(() => {
        heldSuccess = false
        exiting = false
      }, HOLD_MS + EXIT_MS)
    )
  }

  function clearTimers(): void {
    for (const timer of timers) clearTimeout(timer)
    timers = []
  }

  function toggle(): void {
    sidePanel.toggle('downloads')
  }

  const label = $derived(
    mode === 'failed'
      ? `${failedCount} download${failedCount === 1 ? '' : 's'} failed — open Downloads`
      : mode === 'success'
        ? 'Downloads complete — open Downloads'
        : `Downloads — ${pendingCount} pending${failedCount > 0 ? `, ${failedCount} failed` : ''}`
  )

  const status = $derived(
    mode === 'failed'
      ? `Download failed: ${failedCount} item${failedCount === 1 ? '' : 's'}`
      : mode === 'success'
        ? 'Downloads complete'
        : ''
  )

  onDestroy(clearTimers)
</script>

{#if mode !== 'idle'}
  <button
    class="badge {mode}"
    class:moving={downloading}
    class:on={sidePanel.mode === 'downloads'}
    class:exiting
    aria-expanded={sidePanel.mode === 'downloads'}
    aria-label={label}
    title={label}
    onclick={toggle}
  >
    {#key shakeKey}
      <span class="glyph">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          {#if mode === 'success'}
            <path class="check" d="M5 12.5l4.5 4.5L19 7.5" pathLength="1" />
          {:else if mode === 'failed'}
            <path class="mark" d="M12 6.5v7" />
            <path class="mark" d="M12 17.5h.01" />
          {:else}
            <path class="arrow-head" d="M12 3v12M7 10l5 5 5-5" />
            <path class="arrow-tray" d="M5 21h14" />
          {/if}
        </svg>

        {#if mode === 'success'}
          <span class="halo" aria-hidden="true"></span>
        {:else if failedCount > 0 && mode === 'active'}
          <span class="fail-dot" aria-hidden="true"></span>
        {/if}
      </span>
    {/key}
  </button>
{/if}

<span class="sr-only" role="status">{status}</span>

<style>
  .badge {
    position: relative;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text-dim);
    -webkit-app-region: no-drag;
    animation: badge-in 220ms var(--ease);
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease),
      opacity 240ms var(--ease),
      transform 240ms var(--ease);
  }

  .badge:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .badge.on {
    background: var(--glass-active);
    color: var(--text);
  }

  .badge.failed {
    background: rgba(255, 128, 128, 0.08);
    color: var(--danger);
  }

  .badge.failed:hover,
  .badge.failed.on {
    background: rgba(255, 128, 128, 0.13);
    color: var(--danger);
  }

  .badge.success {
    background: var(--glass-hover);
    color: var(--text);
  }

  .badge.exiting {
    opacity: 0;
    transform: scale(0.92);
    pointer-events: none;
  }

  .glyph {
    position: relative;
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
  }

  /* The queue reached a failing state: a single, short shake. The glyph is
     keyed by the failure count, so a later failure plays it again. */
  .badge.failed .glyph {
    animation: fail-shake 400ms cubic-bezier(0.36, 0.07, 0.19, 0.97);
  }

  .glyph svg {
    display: block;
    overflow: visible;
  }

  .arrow-head,
  .arrow-tray,
  .check,
  .mark {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Only the arrow moves; the tray stays put so the glyph still reads as the
     standard download icon while work is running. */
  /* Queued and paused queues are not moving, so the arrow must not imply work. */
  .badge.moving .arrow-head {
    animation: arrow-drift 2.4s cubic-bezier(0.45, 0, 0.25, 1) infinite;
  }

  .check {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: draw-check 300ms cubic-bezier(0.65, 0, 0.35, 1) 80ms forwards;
  }

  .halo {
    position: absolute;
    inset: -2px;
    border: 1px solid var(--stroke-strong);
    border-radius: 50%;
    pointer-events: none;
    animation: halo 620ms var(--ease) 60ms forwards;
  }

  .fail-dot {
    position: absolute;
    top: -2px;
    right: -2px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--danger);
    box-shadow: 0 0 0 2px var(--glass-strong);
    animation: dot-in 260ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  @keyframes badge-in {
    from {
      opacity: 0;
      transform: scale(0.88);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes arrow-drift {
    0%,
    100% {
      transform: translateY(0);
    }
    45%,
    60% {
      transform: translateY(1.6px);
    }
  }

  @keyframes fail-shake {
    0%,
    100% {
      transform: translateX(0);
    }
    20% {
      transform: translateX(-2px);
    }
    40% {
      transform: translateX(2px);
    }
    60% {
      transform: translateX(-1.5px);
    }
    80% {
      transform: translateX(1px);
    }
  }

  @keyframes draw-check {
    to {
      stroke-dashoffset: 0;
    }
  }

  @keyframes halo {
    from {
      opacity: 0.5;
      transform: scale(0.72);
    }
    to {
      opacity: 0;
      transform: scale(1.55);
    }
  }

  @keyframes dot-in {
    from {
      opacity: 0;
      transform: scale(0.4);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .badge,
    .badge.failed .glyph,
    .badge.moving .arrow-head,
    .check,
    .halo,
    .fail-dot {
      animation: none;
    }

    .check {
      stroke-dashoffset: 0;
    }

    .badge {
      transition-duration: 1ms;
    }
  }
</style>
