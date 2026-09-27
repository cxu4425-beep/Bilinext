export const BOTTOM = 4
export const TOP = 5
export const isPinned = (mode: number) => mode === TOP || mode === BOTTOM

export type Placed = {
  mode: number
  lane: number
  /** Scrolling position as a fraction of canvas width. */
  xFrac: number
  /** Text width measured at the declared font size. */
  baseWidth: number
}

/**
 * Picks the row a new danmaku should occupy.
 *
 * The two kinds of danmaku need genuinely different occupancy rules, and
 * conflating them is what made pinned danmaku pile up on a single row:
 *
 * - Pinned (top/bottom) text is centred and holds its whole row for its
 *   lifetime, so a row is busy if anything of the same mode is already in it.
 *   Testing horizontal overlap is meaningless for centred text -- it is almost
 *   never near the right edge, so every pinned danmaku looked placeable in row
 *   0 and they all stacked there.
 * - Scrolling text only needs the previous entry in that row to have fully
 *   entered the frame, and must additionally avoid rows held by top-pinned
 *   danmaku, which occupy the same coordinate space.
 *
 * When every row is busy there are two policies. With `allowOverlap` -- what
 * bilibili's player does -- the danmaku goes where it collides least: the
 * scrolling row whose tail is furthest left, or the pinned row with the fewest
 * occupants. A dense video then stays dense instead of silently losing most of
 * its danmaku. Without it the danmaku is rejected with -1, trading
 * completeness for a clean screen.
 */
export function assignLane(
  active: readonly Placed[],
  mode: number,
  lanes: number,
  width: number,
  scale: number,
  allowOverlap = false,
): number {
  if (lanes <= 0) return -1

  if (isPinned(mode)) {
    let best = -1
    let fewest = Infinity
    for (let l = 0; l < lanes; l++) {
      let n = 0
      for (const a of active) if (a.mode === mode && a.lane === l) n++
      if (n === 0) return l
      if (n < fewest) {
        fewest = n
        best = l
      }
    }
    return allowOverlap ? best : -1
  }

  let best = -1
  let bestScore = Infinity
  for (let l = 0; l < lanes; l++) {
    let tail = -Infinity
    let heldByTop = false
    for (const a of active) {
      if (a.lane !== l) continue
      if (a.mode === TOP) {
        heldByTop = true
        continue
      }
      if (isPinned(a.mode)) continue
      tail = Math.max(tail, a.xFrac * width + a.baseWidth * scale)
    }
    if (!heldByTop && tail <= width - 16) return l

    // A row under a top-pinned danmaku is the last resort even when
    // overlapping; weight it well past any scrolling tail.
    const score = (tail === -Infinity ? 0 : tail) + (heldByTop ? width * 10 : 0)
    if (score < bestScore) {
      bestScore = score
      best = l
    }
  }
  return allowOverlap ? best : -1
}
