/**
 * Run with:  node --experimental-strip-types web/src/lib/danmakuLanes.test.ts
 *
 * Lane assignment is the part of the danmaku renderer most likely to regress
 * silently -- a wrong predicate does not throw, it just quietly piles text on
 * top of itself or throws it away -- so it lives in a pure function with real
 * assertions.
 */
import assert from 'node:assert/strict'
import { assignLane, TOP, BOTTOM, type Placed } from './danmakuLanes.ts'

const W = 1000
const S = 1
const place = (active: Placed[], mode: number, lanes = 10, overlap = false) => {
  const lane = assignLane(active, mode, lanes, W, S, overlap)
  if (lane >= 0) active.push({ mode, lane, xFrac: 1, baseWidth: 100 })
  return lane
}

// 1. Simultaneous top-pinned danmaku must take distinct rows (reported bug).
{
  const active: Placed[] = []
  const lanes = Array.from({ length: 7 }, () => place(active, TOP))
  assert.deepEqual(lanes, [0, 1, 2, 3, 4, 5, 6], 'top-pinned must not stack')
}

// 2. Top and bottom pinned keep independent row pools.
{
  const active: Placed[] = []
  place(active, TOP)
  place(active, TOP)
  assert.equal(place(active, BOTTOM), 0, 'bottom pool is independent of top')
  assert.equal(place(active, BOTTOM), 1)
}

// 3. Scrolling text must not be placed into a row held by a top-pinned one.
{
  const active: Placed[] = [{ mode: TOP, lane: 0, xFrac: 0.4, baseWidth: 100 }]
  assert.equal(place(active, 1), 1, 'scrolling must skip top-pinned rows')
}

// 4. Scrolling text may reuse a row once the previous entry has fully entered.
{
  const entered: Placed[] = [{ mode: 1, lane: 0, xFrac: 0.5, baseWidth: 100 }]
  assert.equal(assignLane(entered, 1, 10, W, S), 0, 'row free once text is inside')
  const notYet: Placed[] = [{ mode: 1, lane: 0, xFrac: 0.99, baseWidth: 100 }]
  assert.equal(assignLane(notYet, 1, 10, W, S), 1, 'row busy while text still entering')
}

// 5. Bottom-pinned danmaku live in their own space and block nothing above.
{
  const active: Placed[] = [{ mode: BOTTOM, lane: 0, xFrac: 0.4, baseWidth: 100 }]
  assert.equal(place(active, 1), 0, 'bottom-pinned must not block scrolling rows')
}

// 6. Without overlap, a full screen reports -1 so the caller drops it.
{
  const active: Placed[] = Array.from({ length: 3 }, (_, i) => ({
    mode: TOP,
    lane: i,
    xFrac: 0.5,
    baseWidth: 100,
  }))
  assert.equal(assignLane(active, TOP, 3, W, S), -1, 'no free row -> drop')
}

// 7. With overlap, a full screen of scrolling text picks the row with the most
//    room -- the one whose tail is furthest left -- instead of dropping.
{
  const busy: Placed[] = [
    { mode: 1, lane: 0, xFrac: 0.99, baseWidth: 100 }, // tail 1090
    { mode: 1, lane: 1, xFrac: 0.9, baseWidth: 100 }, // tail 1000
    { mode: 1, lane: 2, xFrac: 0.95, baseWidth: 100 }, // tail 1050
  ]
  assert.equal(assignLane(busy, 1, 3, W, S, false), -1, 'overlap off still drops')
  assert.equal(assignLane(busy, 1, 3, W, S, true), 1, 'overlap picks least-collision row')
}

// 8. With overlap, pinned text goes to the row with the fewest occupants.
{
  const active: Placed[] = [
    { mode: TOP, lane: 0, xFrac: 0.5, baseWidth: 100 },
    { mode: TOP, lane: 0, xFrac: 0.5, baseWidth: 100 },
    { mode: TOP, lane: 1, xFrac: 0.5, baseWidth: 100 },
    { mode: TOP, lane: 2, xFrac: 0.5, baseWidth: 100 },
  ]
  assert.equal(assignLane(active, TOP, 3, W, S, true), 1, 'fewest occupants wins')
}

// 9. Even when overlapping, a row under a top-pinned danmaku is the last resort.
{
  const active: Placed[] = [
    { mode: TOP, lane: 0, xFrac: 0.5, baseWidth: 100 },
    { mode: 1, lane: 1, xFrac: 0.99, baseWidth: 100 },
  ]
  assert.equal(assignLane(active, 1, 2, W, S, true), 1, 'avoid the top-pinned row')
}

console.log('danmakuLanes: all 9 assertions passed')
