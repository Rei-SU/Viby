import assert from 'node:assert/strict'
import { railLayout, RAIL_MAX_CARD, RAIL_MIN_CARD } from '../src/renderer/lib/rail-fit'

const gap = 18

function fills(layout: { cols: number; cardWidth: number }, available: number): boolean {
  return Math.abs(layout.cols * layout.cardWidth + (layout.cols - 1) * gap - available) < 0.01
}

console.log('\nrail fit')

// Widths from the real layouts: 1420/1180/920/860, with lyrics open and closed.
for (const [available, expectedCols, expectedCard] of [
  [1300, 8, 146.75],
  [1060, 7, 136],
  [920, 6, 138.33333333333334],
  [800, 5, 145.6],
  [740, 5, 133.6],
  [706, 4, 163],
  [480, 3, 148],
  [420, 3, 128]
] as const) {
  const layout = railLayout(available, 20, gap)
  assert.equal(layout.cols, expectedCols, `cols at ${available}px`)
  assert.ok(Math.abs(layout.cardWidth - expectedCard) < 0.01, `card width at ${available}px`)
  assert.ok(fills(layout, available), `cards fill ${available}px`)
  assert.ok(layout.cardWidth >= Math.min(RAIL_MIN_CARD, available) - 2, `cards stay readable at ${available}px`)
  assert.ok(layout.cardWidth <= RAIL_MAX_CARD + 0.01, `cards stay capped at ${available}px`)
}

{
  const layout = railLayout(480, 3, gap)
  assert.deepEqual(layout, { cols: 3, cardWidth: 148 })
  assert.ok(fills(layout, 480))
}

{
  // A short shelf keeps the rail's card size instead of stretching one card
  // across the whole page.
  const layout = railLayout(1300, 1, gap)
  assert.equal(layout.cols, 8)
  assert.equal(layout.cardWidth, 146.75)
}

{
  // Fewer items than the ideal count: the cards stay the same size as a full
  // shelf and leave the remaining slots open.
  const layout = railLayout(920, 3, gap)
  assert.equal(layout.cols, 6)
  assert.ok(Math.abs(layout.cardWidth - 138.33333333333334) < 0.01)
}

{
  // Extremely narrow rails still show whole cards, even if below the ideal min.
  const layout = railLayout(200, 5, gap)
  assert.equal(layout.cols, 2)
  assert.equal(layout.cardWidth, 91)
}

assert.deepEqual(railLayout(0, 5, gap), { cols: 0, cardWidth: 0 })
assert.deepEqual(railLayout(500, 0, gap), { cols: 0, cardWidth: 0 })
assert.deepEqual(railLayout(Number.NaN, 5, gap), { cols: 0, cardWidth: 0 })

console.log('  PASS  whole cards fit the rail')
console.log('  PASS  short shelves keep their card size')
console.log('  PASS  narrow rails stay usable')
console.log('  PASS  empty rails are ignored')

console.log('\nALL PASSED')
