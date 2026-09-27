import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { BOTTOM, TOP, assignLane, isPinned } from '@/lib/danmakuLanes'

export type Danmaku = {
  time: number
  mode: number
  size: number
  color: number
  text: string
  dmid: string
}

/** Screen rect of a danmaku, so the player can anchor a menu to it. */
export type DanmakuHit = { dmid: string; text: string; x: number; y: number; w: number; h: number }

export type DanmakuHandle = {
  hitTest: (x: number, y: number) => DanmakuHit | null
  /** Holds one danmaku still so its hover menu can actually be clicked. */
  freeze: (dmid: string | null) => void
}

type Active = {
  dmid: string
  text: string
  color: string
  mode: number
  lane: number
  /** Size declared by the stream (25 = standard). Scaled at draw time. */
  declared: number
  /** Text width measured at `declared` px, so it scales linearly with size. */
  baseWidth: number
  /** Scrolling position as a fraction of canvas width; resolution-independent. */
  xFrac: number
  /** Pinned danmaku are centred at draw time so a resize re-centres them. */
  centred: boolean
  bornAt: number
  /** Where it was last drawn; the source of truth for hit-testing. */
  rect: { x: number; y: number; w: number; h: number } | null
}

/**
 * Bilibili renders danmaku in SimHei; the fallbacks matter because SimHei only
 * ships on Windows, and a proportional fallback such as PingFang changes the
 * character rhythm enough to read as "not the real thing".
 *
 * The weight is deliberately NOT bold. SimHei has a single weight, so asking
 * for bold makes the browser synthesise it by smearing the glyphs, which comes
 * out visibly heavier than bilibili's own rendering.
 */
const FONT_STACK = 'SimHei, "Heiti SC", "Microsoft JhengHei", "PingFang TC", sans-serif'

const BASE_SIZE = 25
/**
 * Below this player height the fixed size would leave only a few rows, so
 * danmaku shrink in proportion -- as bilibili's own mini player does.
 */
const SMALL_PLAYER_HEIGHT = 450
const SCROLL_SECONDS = 9
/** Upper bound on simultaneous danmaku; bilibili's dense screens hold a few hundred. */
const MAX_ACTIVE = 500
/** Pinned danmaku hold their slot for this long. */
const PINNED_MS = 4000

/**
 * Danmaku are drawn on a canvas rather than as DOM nodes: a busy video can have
 * hundreds on screen at once, and animating that many elements drops frames on
 * phones. The canvas stays transparent to pointer events so it never
 * intercepts a tap meant for the player underneath.
 *
 * The animation loop is created once and reads its inputs through refs. Making
 * currentTime an effect dependency would tear the loop down and clear the
 * canvas several times a second, which leaves nothing visible on screen.
 */
const DanmakuLayer = forwardRef<
  DanmakuHandle,
  {
    items?: Danmaku[]
    currentTime: number
    playing: boolean
    /** Fraction of the video height danmaku may occupy: 1 = full screen. */
    area?: number
    opacity?: number
    fontScale?: number
    /** Overlap text once every row is busy, as bilibili does, instead of dropping it. */
    allowOverlap?: boolean
    /** In full screen, rescale relative to the windowed size (bilibili's fullscreensync). */
    fullscreenSync?: boolean
  }
>(function DanmakuLayer(
  {
    items,
    currentTime,
    playing,
    area = 1,
    opacity = 1,
    fontScale = 1,
    allowOverlap = true,
    fullscreenSync = false,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const active = useRef<Active[]>([])
  const cursor = useRef(0)
  const lastTime = useRef(0)

  const itemsRef = useRef<Danmaku[] | undefined>(items)
  const timeRef = useRef(currentTime)
  const playingRef = useRef(playing)
  const areaRef = useRef(area)
  const opacityRef = useRef(opacity)
  const fontScaleRef = useRef(fontScale)
  const overlapRef = useRef(allowOverlap)
  const syncRef = useRef(fullscreenSync)
  const frozenRef = useRef<string | null>(null)

  useImperativeHandle(ref, () => ({
    hitTest: (x, y) => {
      // Newest last in the array, so scan backwards to prefer what is on top.
      for (let i = active.current.length - 1; i >= 0; i--) {
        const a = active.current[i]
        const r = a.rect
        if (!a.dmid || !r) continue
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          return { dmid: a.dmid, text: a.text, ...r }
        }
      }
      return null
    },
    freeze: (dmid) => {
      frozenRef.current = dmid
    },
  }))

  useEffect(() => {
    itemsRef.current = items
    cursor.current = 0
    active.current = []
    lastTime.current = 0
  }, [items])

  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  useEffect(() => {
    overlapRef.current = allowOverlap
  }, [allowOverlap])

  useEffect(() => {
    syncRef.current = fullscreenSync
  }, [fullscreenSync])

  useEffect(() => {
    areaRef.current = area
    opacityRef.current = opacity
    fontScaleRef.current = fontScale
    // Lane counts change with the area, so old placements are no longer valid.
    active.current = []
  }, [area, opacity, fontScale])

  useEffect(() => {
    timeRef.current = currentTime
    // A jump means everything on screen is stale and the queue position is
    // wrong; re-seek the cursor with a binary search over the sorted list.
    if (Math.abs(currentTime - lastTime.current) > 1.5) {
      active.current = []
      const list = itemsRef.current ?? []
      let lo = 0
      let hi = list.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (list[mid].time < currentTime) lo = mid + 1
        else hi = mid
      }
      cursor.current = lo
    }
    lastTime.current = currentTime
  }, [currentTime])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    let width = 0
    let height = 0
    /** Last windowed height, the baseline full screen scales against. */
    let normalHeight = 0
    const inFullscreen = () => {
      const f = document.fullscreenElement
      return !!f && f.contains(canvas)
    }
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      width = rect.width
      height = rect.height
      if (!inFullscreen()) normalHeight = rect.height
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let prev = performance.now()
    let raf = 0

    // Canvas does not accept CSS custom properties in `font`; a var() here is
    // rejected outright and silently leaves the default 10px sans-serif.
    const fontFor = (px: number) => `${px}px ${FONT_STACK}`

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min((now - prev) / 1000, 0.05)
      prev = now
      if (!width || !height) return

      ctx.clearRect(0, 0, width, height)
      ctx.textBaseline = 'top'
      ctx.lineJoin = 'round'
      ctx.miterLimit = 2
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'
      ctx.globalAlpha = opacityRef.current

      const list = itemsRef.current
      const time = timeRef.current
      const isPlaying = playingRef.current

      // bilibili sizes danmaku in fixed CSS pixels -- 25px times the font
      // setting -- instead of scaling them with the player, so a normal window
      // shows them at the same size as the official client. Scaling with player
      // height made them ~1.5x smaller than bilibili's in a typical window.
      // Two exceptions: a small player shrinks them so a handful of rows still
      // fit, and full screen rescales relative to the windowed size when sync is
      // on (bilibili's fullscreensync). Recomputed every frame, so everything on
      // screen rescales together when the size changes.
      const fit = Math.min(1, height / SMALL_PLAYER_HEIGHT)
      const sync =
        syncRef.current && normalHeight > 0 && inFullscreen() ? height / normalHeight : 1
      const scale = fontScaleRef.current * (sync > 1 ? sync : fit)
      const laneHeight = Math.max(12, BASE_SIZE * scale * 1.25)
      const usable = Math.max(laneHeight, height * areaRef.current)
      const lanes = Math.max(1, Math.floor(usable / laneHeight))

      if (isPlaying && list?.length) {
        while (
          cursor.current < list.length &&
          list[cursor.current].time <= time &&
          active.current.length < MAX_ACTIVE
        ) {
          const d = list[cursor.current++]
          const declared = d.size || BASE_SIZE
          ctx.font = fontFor(declared)
          const baseWidth = ctx.measureText(d.text).width
          const pinned = isPinned(d.mode)

          const lane = assignLane(active.current, d.mode, lanes, width, scale, overlapRef.current)

          // Only reachable with overlap turned off: every row is busy, so drop it.
          if (lane < 0) continue

          active.current.push({
            dmid: d.dmid || '',
            text: d.text,
            color: `#${(d.color || 0xffffff).toString(16).padStart(6, '0')}`,
            mode: d.mode,
            lane,
            declared,
            baseWidth,
            xFrac: 1,
            centred: pinned,
            bornAt: now,
            rect: null,
          })
        }
        // Skip anything we could not admit because the screen was full.
        while (cursor.current < list.length && list[cursor.current].time <= time - 1) {
          cursor.current++
        }
      }

      const speedFrac = 1 / SCROLL_SECONDS

      active.current = active.current.filter((a) => {
        const pinned = isPinned(a.mode)
        // Moving in fractions of the width keeps speed constant across resizes.
        // A frozen danmaku is one the pointer is on: it must stay put or its
        // menu would slide out from under the cursor.
        const frozen = a.dmid !== '' && a.dmid === frozenRef.current
        if (isPlaying && !pinned && !frozen) a.xFrac -= speedFrac * dt

        const fontSize = a.declared * scale
        const w = a.baseWidth * scale
        const x = a.centred ? (width - w) / 2 : a.xFrac * width

        // A pinned danmaku with its menu open outlives its slot until closed.
        if (pinned && !frozen && now - a.bornAt > PINNED_MS) return false
        if (!pinned && x + w < 0) return false

        // Top-pinned stacks down from the top, bottom-pinned up from the
        // bottom, and scrolling text shares the top lanes with neither.
        const y =
          a.mode === BOTTOM
            ? height - laneHeight * (a.lane + 1) - 4
            : 4 + a.lane * laneHeight

        a.rect = { x, y, w, h: fontSize * 1.2 }

        ctx.font = fontFor(fontSize)
        // A thin outline, scaled with the text. The previous fixed 2.2px stroke
        // sat far outside the glyphs and read as extra weight.
        ctx.lineWidth = Math.max(1, fontSize * 0.055)
        ctx.strokeText(a.text, x, y)
        ctx.fillStyle = frozen ? '#ffffff' : a.color
        ctx.fillText(a.text, x, y)
        return true
      })

      ctx.globalAlpha = 1
    }

    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className="danmaku-layer w-full h-full" aria-hidden="true" />
})

export default DanmakuLayer
