<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte'
  import { scrambleClock } from '../lib/pixel-scramble'

  /**
   * A 5×7 dot-matrix clock. Drawn as SVG instead of loading a pixel font, so
   * it stays crisp at any size and needs no network or extra dependency.
   */
  const GLYPHS: Record<string, string[]> = {
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    ':': ['0', '0', '1', '0', '1', '0', '0']
  }

  const HEIGHT = 7
  const GAP = 1
  const TICK_MS = 45

  let {
    value,
    // Rendered height in pixels; the width follows from the glyph metrics.
    height = 28,
    label,
    /** Unit captions under the hour and minute groups. */
    units = false
  }: { value: string; height?: number; label?: string; units?: boolean } = $props()

  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // The first frame is already scrambled, so the real value never flashes
  // before the animation starts. This deliberately snapshots the initial prop.
  let display = $state(
    untrack(() => (reduceMotion ? value : scrambleClock(value, 0).text))
  )
  let scrambling = $state(!reduceMotion)
  let timer: ReturnType<typeof setInterval> | null = null

  onMount(() => {
    if (reduceMotion) {
      display = value
      scrambling = false
      return
    }

    const started = performance.now()
    timer = setInterval(() => {
      const frame = scrambleClock(value, performance.now() - started)
      display = frame.text
      if (frame.done) finish()
    }, TICK_MS)
  })

  onDestroy(() => {
    if (timer) clearInterval(timer)
  })

  function finish(): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    display = value
    scrambling = false
  }

  // A value change after the boot must update in place, not start a new
  // scramble; the animation belongs to the Home mount, not the numbers.
  $effect(() => {
    if (!scrambling) display = value
  })

  const layout = $derived.by(() => {
    const chars = [...display]
    const pixels: { x: number; y: number }[] = []
    let offset = 0

    for (const [index, char] of chars.entries()) {
      const glyph = GLYPHS[char]
      if (!glyph) continue
      const width = glyph[0].length
      for (const [y, row] of glyph.entries()) {
        for (const [x, cell] of [...row].entries()) {
          if (cell === '1') pixels.push({ x: offset + x, y })
        }
      }
      offset += width + (index < chars.length - 1 ? GAP : 0)
    }

    return { pixels, width: Math.max(1, offset) }
  })

  const width = $derived((height * layout.width) / HEIGHT)

  /** Where each unit label sits, as a percentage of the display width. */
  const unitPositions = $derived.by(() => {
    const colon = display.indexOf(':')
    if (colon < 1) return null
    const hoursCells = colon * 5 + (colon - 1) * GAP
    const minutes = display.length - colon - 1
    const minutesCells = minutes * 5 + (minutes - 1) * GAP
    return {
      hours: (hoursCells / 2 / layout.width) * 100,
      minutes: ((layout.width - minutesCells / 2) / layout.width) * 100
    }
  })
</script>

<span
  class="pixel-clock"
  role="img"
  aria-label={label}
  data-clock-value={value}
  data-display={display}
  data-scrambling={scrambling}
  data-scrambled={!scrambling}
  style="--clock-height: {height}px; --clock-width: {width}px"
>
  <svg
    class="clock"
    viewBox="0 0 {layout.width} {HEIGHT}"
    width={width}
    height={height}
    aria-hidden="true"
  >
    {#each layout.pixels as pixel (pixel.x + ':' + pixel.y)}
      <rect x={pixel.x + 0.11} y={pixel.y + 0.11} width="0.78" height="0.78" rx="0.15" />
    {/each}
  </svg>
  {#if units && unitPositions}
    <span class="units" aria-hidden="true">
      <span class="unit" style="left: {unitPositions.hours}%">HRS</span>
      <span class="unit" style="left: {unitPositions.minutes}%">MIN</span>
    </span>
  {/if}
</span>

<style>
  .pixel-clock {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
    color: inherit;
    line-height: 0;
  }

  .clock {
    display: block;
    width: var(--clock-width);
    height: var(--clock-height);
    overflow: visible;
  }

  rect {
    fill: currentColor;
  }

  .units {
    position: relative;
    display: block;
    width: var(--clock-width);
    height: 9px;
    margin-top: 5px;
    color: var(--text-faint);
    opacity: 0.9;
  }

  .unit {
    position: absolute;
    top: 0;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.14em;
    line-height: 1;
    transform: translateX(-50%);
    white-space: nowrap;
  }
</style>
