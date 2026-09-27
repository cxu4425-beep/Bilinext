import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { duration as fmt } from '@/lib/format'
import * as I from './Icons'
import DanmakuLayer, { type Danmaku, type DanmakuHandle, type DanmakuHit } from './DanmakuLayer'
import DanmakuMenu from './DanmakuMenu'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'

export type Track = {
  id: number
  codecs: string
  width?: number
  height?: number
  bandwidth: number
  url: string
}
export type PlayData = {
  dash: { duration: number; video: Track[]; audio: Track[] } | null
  durl: { url: string; length: number }[]
  acceptQuality: number[]
  acceptDescription: string[]
}
export type { Danmaku }

export type PlayerHandle = { seek: (seconds: number) => void; currentTime: () => number }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

const QN_LABEL: Record<number, string> = {
  127: '8K', 126: '杜比視界', 125: 'HDR', 120: '4K', 116: '1080P60',
  112: '1080P+', 80: '1080P', 74: '720P60', 64: '720P', 32: '480P', 16: '360P',
}

/**
 * Bilibili's DASH gives video and audio as two independent complete files, so
 * playback runs two media elements kept in lockstep. The video element is the
 * clock; audio is slaved to it and nudged back whenever it drifts.
 */
const Player = forwardRef<PlayerHandle, {
  play?: PlayData
  danmaku?: Danmaku[]
  poster?: string
  title?: string
  onQualityChange?: (qn: number) => void
  quality?: number
  wide?: boolean
  onToggleWide?: () => void
  /** cid of the current part; danmaku actions are keyed on it. */
  oid?: number | string
  /** With oid, lets the player read the account's synced danmaku settings. */
  aid?: number
  autoPlay?: boolean
  /** Where the account last stopped in this part, in seconds; applied once per part. */
  startAt?: number
  /** Receives the playhead whenever it is worth recording on the account. */
  onProgress?: (p: { aid: number; cid: number | string; seconds: number }) => void
}>(function Player(
  {
    play, danmaku, poster, title, onQualityChange, quality, wide, onToggleWide, oid, aid, autoPlay,
    startAt, onProgress,
  },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<number>(0)

  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('bili.volume') ?? 1))
  const [muted, setMuted] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [danmakuOn, setDanmakuOn] = useState(
    () => localStorage.getItem('bili.danmaku') !== 'off',
  )
  const [menu, setMenu] = useState<'none' | 'quality' | 'speed' | 'danmaku'>('none')
  // Transient centre flourish shown when playback is toggled.
  const [pop, setPop] = useState<{ id: number; kind: 'play' | 'pause' } | null>(null)
  const [dmArea, setDmArea] = useState(() => Number(localStorage.getItem('bili.dmArea') ?? 1))
  const [dmOpacity, setDmOpacity] = useState(
    () => Number(localStorage.getItem('bili.dmOpacity') ?? 1),
  )
  const [dmScale, setDmScale] = useState(() => Number(localStorage.getItem('bili.dmScale') ?? 1))
  // Off by default: bilibili lets danmaku overlap once the screen is full.
  const [dmNoOverlap, setDmNoOverlap] = useState(() => localStorage.getItem('bili.dmNoOverlap') === '1')
  // Off by default: full screen keeps the windowed font size and uses the extra
  // room for more rows. A new key, so the earlier default of "on" is not reused.
  const [dmFsSync, setDmFsSync] = useState(() => localStorage.getItem('bili.dmFsSyncOn') === '1')
  const [started, setStarted] = useState(false)
  const danmakuRef = useRef<DanmakuHandle>(null)
  /** Set when the picture is running but the browser refused to start audio. */
  const [audioBlocked, setAudioBlocked] = useState(false)
  const autoTriedFor = useRef<string | null>(null)
  const [hovered, setHovered] = useState<DanmakuHit | null>(null)
  // A menu the user closed stays closed until the pointer leaves that danmaku.
  const dismissedRef = useRef<string | null>(null)
  const [rate, setRate] = useState(1)
  const rateRef = useRef(1)
  const [waiting, setWaiting] = useState(false)

  // Read from media events, timers and gesture timeouts, which must see the
  // latest values without re-subscribing on every render.
  const oidRef = useRef(oid)
  const aidRef = useRef(aid)
  const onProgressRef = useRef(onProgress)
  const hoveredRef = useRef<DanmakuHit | null>(null)
  oidRef.current = oid
  aidRef.current = aid
  onProgressRef.current = onProgress
  hoveredRef.current = hovered

  /**
   * The stretch of playback being reported, pinned to the part it belongs to.
   * A position means nothing without its cid, and by the time a change of part
   * is observable the element has already been reset to 0 for the next one --
   * so the part and its last known time travel together here instead of being
   * read back off the element.
   */
  const session = useRef<{ oid: number | string; aid: number; time: number; reported: number } | null>(
    null,
  )
  const appliedStartFor = useRef<string | null>(null)
  const [resumeNote, setResumeNote] = useState<number | null>(null)

  const [fullscreen, setFullscreen] = useState(false)
  const [brightness, setBrightness] = useState(1)
  const [gestureHud, setGestureHud] = useState<
    | { kind: 'seek'; target: number; delta: number }
    | { kind: 'volume' | 'brightness'; value: number }
    | null
  >(null)
  const [seekFlash, setSeekFlash] = useState<{ id: number; dir: -1 | 1 } | null>(null)
  /** The kind of the most recent pointer, so touch never runs mouse-only paths. */
  const lastPointer = useRef('mouse')
  const gesture = useRef<{
    id: number
    x0: number
    y0: number
    left: number
    w: number
    h: number
    mode: 'pending' | 'seek' | 'volume' | 'brightness'
    time0: number
    vol0: number
    bright0: number
    value: number
  } | null>(null)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)
  const tapTimer = useRef(0)

  // Prefer H.264: HEVC/AV1 decode is inconsistent across the Android WebView
  // and older desktop browsers this app is expected to run on.
  const videoTrack =
    play?.dash?.video.find((t) => t.codecs.startsWith('avc')) ?? play?.dash?.video[0]
  const audioTrack = play?.dash?.audio?.[0]
  const progressiveUrl = !play?.dash ? play?.durl?.[0]?.url : undefined
  const hasSeparateAudio = Boolean(play?.dash && audioTrack)

  useImperativeHandle(ref, () => ({
    seek: (seconds: number) => {
      const v = videoRef.current
      if (!v) return
      setHovered(null)
      danmakuRef.current?.freeze(null)
      v.currentTime = Math.max(0, seconds)
      if (audioRef.current) audioRef.current.currentTime = v.currentTime
      v.play().catch(() => {})
    },
    currentTime: () => videoRef.current?.currentTime ?? 0,
  }))

  /* --------------------------------------------------------------- a/v sync */

  /**
   * Two-tier drift correction. A hard seek on the audio element is audible, so
   * it is reserved for genuine desync (after a seek, or a long stall). Small
   * offsets -- which is what normally accumulates -- are absorbed by running
   * the audio fractionally fast or slow until it lines back up, which is
   * inaudible. Lip-sync error becomes noticeable around 100ms, so that is the
   * point where correction starts rather than a quarter of a second.
   */
  const syncAudio = useCallback(
    (force = false) => {
      const v = videoRef.current
      const a = audioRef.current
      if (!v || !a || !hasSeparateAudio) return
      const drift = v.currentTime - a.currentTime
      const mag = Math.abs(drift)

      if (force || mag > 0.35) {
        a.currentTime = v.currentTime
        a.playbackRate = rateRef.current
        return
      }
      if (mag > 0.08) {
        // Audio behind -> speed it up slightly, and vice versa.
        a.playbackRate = rateRef.current * (drift > 0 ? 1.02 : 0.98)
      } else if (a.playbackRate !== rateRef.current) {
        a.playbackRate = rateRef.current
      }
    },
    [hasSeparateAudio],
  )

  useEffect(() => {
    if (!hasSeparateAudio) return
    const id = setInterval(() => playing && syncAudio(), 400)
    return () => clearInterval(id)
  }, [playing, hasSeparateAudio, syncAudio])

  useEffect(() => {
    rateRef.current = rate
    const a = audioRef.current
    if (a) {
      a.volume = muted ? 0 : volume
      a.playbackRate = rate
    }
    const v = videoRef.current
    if (v) {
      // With a separate audio track the video element must stay silent.
      v.volume = hasSeparateAudio ? 0 : muted ? 0 : volume
      v.playbackRate = rate
    }
  }, [volume, muted, rate, hasSeparateAudio])

  /* ------------------------------------------------------------- controls */

  const toggle = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }, [])

  /**
   * Sends the session's position if it moved. Only whole seconds are stored by
   * bilibili, so smaller changes are not worth a request. The time comes from
   * the session, never from the element -- see `session`.
   */
  const flushProgress = useCallback(() => {
    const s = session.current
    const cb = onProgressRef.current
    if (!s || !cb || !Number.isFinite(s.time)) return
    // Until the stored position has been read and acted on, whatever the
    // element says is not where the user is -- reporting it would overwrite
    // the real resume point. This actually happened: a few seconds of
    // autoplay from 0 replaced a 36s position on the account.
    if (appliedStartFor.current !== String(s.oid)) return
    if (Math.abs(s.time - s.reported) < 1) return
    s.reported = s.time
    cb({ aid: s.aid, cid: s.oid, seconds: s.time })
  }, [])

  const onPlay = () => {
    setPlaying(true)
    setStarted(true)
    setPop({ id: Date.now(), kind: 'play' })
    // Opening a video without playing it records nothing; a session begins at
    // the first real play of a part.
    const v = videoRef.current
    if (v && !session.current && oidRef.current && aidRef.current) {
      session.current = {
        oid: oidRef.current,
        aid: aidRef.current,
        time: v.currentTime,
        reported: v.currentTime,
      }
    }
    if (hasSeparateAudio) {
      syncAudio(true)
      startAudio()
    }
  }
  const onPause = () => {
    setPlaying(false)
    setPop({ id: Date.now(), kind: 'pause' })
    audioRef.current?.pause()
    // play() fires `play` before it rejects, so a blocked autoplay leaves the
    // flag set on an element that then pauses straight back. Nothing is
    // playing at that point, so there is no silent picture to warn about.
    setAudioBlocked(false)
    // `timeupdate` fires just before `pause`, so the session is already current.
    flushProgress()
  }

  /**
   * Natural end fires `ended`, not `pause`, so without this the audio element
   * would carry on playing past the end of the picture.
   */
  const onEnded = () => {
    setPlaying(false)
    setAudioBlocked(false)
    const a = audioRef.current
    if (a) {
      a.pause()
      a.currentTime = videoRef.current?.duration ?? a.currentTime
    }
    const v = videoRef.current
    if (session.current && v?.duration) session.current.time = v.duration
    flushProgress()
  }

  /**
   * The element is about to be reset for a new source (another part, another
   * video, or a quality switch). `emptied` is queued ahead of the reset's own
   * events, so this is the last moment the session still describes what was
   * actually watched.
   */
  const onEmptied = () => {
    flushProgress()
    session.current = null
  }

  /**
   * Starts the audio element and reports only a *genuine* refusal.
   *
   * play() rejects for two very different reasons here. NotAllowedError means
   * the browser withheld permission and the picture really is running silent.
   * AbortError means we interrupted our own request -- onWaiting pauses the
   * audio whenever the video stalls, which aborts any play() still in flight.
   * Treating the second as a block put a "turn the sound on" prompt over
   * perfectly audible video.
   */
  const startAudio = () => {
    audioRef.current
      ?.play()
      .then(() => setAudioBlocked(false))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          setAudioBlocked(true)
        }
      })
  }

  const onTimeUpdate = () => {
    const v = videoRef.current
    if (!v) return
    setTime(v.currentTime)
    if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1))
    if (session.current) session.current.time = v.currentTime
  }

  const seekTo = (seconds: number) => {
    const v = videoRef.current
    if (!v) return
    // Seeking clears the danmaku on screen, so a menu for one of them goes too.
    setHovered(null)
    danmakuRef.current?.freeze(null)
    v.currentTime = Math.min(Math.max(0, seconds), dur || v.duration || 0)
    syncAudio(true)
  }

  /** While the video stalls, the audio must stall with it or sync is lost. */
  const onWaiting = () => {
    setWaiting(true)
    if (hasSeparateAudio) audioRef.current?.pause()
  }
  const onPlaying = () => {
    setWaiting(false)
    if (hasSeparateAudio && !videoRef.current?.paused) {
      syncAudio(true)
      startAudio()
    }
  }

  /**
   * Hit-tests the danmaku canvas on every pointer move. The canvas itself stays
   * pointer-events:none so it never swallows a click meant for the video; only
   * the resulting menu is interactive.
   */
  const trackDanmaku = (e: React.MouseEvent) => {
    if (!danmakuOn || !danmakuRef.current) return
    // Moving onto the menu itself must not dismiss it.
    if ((e.target as HTMLElement)?.closest?.('[data-danmaku-menu]')) return

    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const hit = danmakuRef.current.hitTest(e.clientX - rect.left, e.clientY - rect.top)
    // Moving off every danmaku leaves an open menu where it is -- it closes on
    // a click on empty video, Escape, or a seek -- and re-arms a dismissed one.
    if (!hit) {
      dismissedRef.current = null
      return
    }
    if (hit.dmid === hovered?.dmid || hit.dmid === dismissedRef.current) return
    setHovered(hit)
    danmakuRef.current.freeze(hit.dmid)
  }

  const closeMenu = () => {
    dismissedRef.current = hovered?.dmid ?? null
    setHovered(null)
    danmakuRef.current?.freeze(null)
  }

  // Escape dismisses the menu as well; bound only while one is open.
  useEffect(() => {
    if (!hovered) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hovered])

  /**
   * Autoplay, with the one wrinkle that matters here: bilibili's DASH video
   * track carries no audio, so the browser treats the <video> element as muted
   * and will start it without a user gesture. The separate <audio> element gets
   * no such exemption. Starting only the video would leave a silent picture
   * playing, which is worse than not starting -- so a refused audio start is
   * surfaced as an explicit "turn the sound on" prompt.
   */
  useEffect(() => {
    const src = videoTrack?.url ?? progressiveUrl
    // Waits for the resume answer (startAt undefined = still asking): starting
    // at 0 and jumping a moment later looks broken, and leaving inside that
    // window would record 0 over the real position.
    if (!autoPlay || !src || startAt === undefined || autoTriedFor.current === src) return
    autoTriedFor.current = src

    // Only the video is started here. The `play` event fires onPlay, which
    // already starts and syncs the audio -- calling play() on the audio from
    // both places races: the second call aborts the first one's promise and
    // that rejection is indistinguishable from a genuine autoplay refusal.
    videoRef.current?.play().catch(() => {
      // Even silent playback was refused; leave the poster and its button.
    })
  }, [videoTrack?.url, progressiveUrl, autoPlay, startAt])

  /** Clicking the prompt is the user gesture the audio element was waiting for. */
  const enableAudio = async () => {
    const v = videoRef.current
    const a = audioRef.current
    if (!v || !a) return
    try {
      a.currentTime = v.currentTime
      await a.play()
      setAudioBlocked(false)
      setMuted(false)
    } catch {
      // Still refused: leave the prompt up rather than silently giving up.
    }
  }

  const nudgeControls = () => {
    setShowControls(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (!videoRef.current?.paused) setShowControls(false)
    }, 2600)
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else wrapRef.current?.requestFullscreen().catch(() => {})
  }

  useEffect(() => {
    const onChange = () => {
      const on = document.fullscreenElement === wrapRef.current
      setFullscreen(on)
      // Brightness can only be changed in full screen, so leaving it must not
      // strand a dimmed picture with no gesture to undo it.
      if (!on) setBrightness(1)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  /* ---------------------------------------------------------- touch gestures */

  /**
   * Touch gestures, as on bilibili's app:
   *
   * - tap: show or hide the controls (a tap that paused would make them
   *   unreachable without interrupting the video)
   * - double tap: left third back 10s, right third forward 10s, middle
   *   play/pause
   * - horizontal drag: scrub, applied on release so the video is not asked to
   *   seek dozens of times per second
   * - vertical drag, full screen only: left half brightness, right half volume
   *
   * Vertical drags are limited to full screen because in the page the player
   * sits above the comments, and a player that swallowed vertical swipes would
   * make the page impossible to scroll past it. touch-action lets the browser
   * keep those as scrolls, which surfaces here as pointercancel.
   *
   * Mouse input never reaches these handlers.
   */
  const DOUBLE_TAP_MS = 280
  const SWIPE_SLOP = 12
  /** A full-width drag covers this many seconds, or the whole video if shorter. */
  const SCRUB_SPAN = 120

  const onGestureTarget = (el: EventTarget | null) =>
    !(el instanceof Element && el.closest('button, input, a, [data-player-controls], [data-danmaku-menu]'))

  const showControlsBriefly = () => {
    clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (!videoRef.current?.paused) setShowControls(false)
    }, 3500)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    lastPointer.current = e.pointerType
    if (e.pointerType !== 'touch' || !started || !onGestureTarget(e.target)) return
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return
    gesture.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      left: r.left,
      w: r.width,
      h: r.height,
      mode: 'pending',
      time0: videoRef.current?.currentTime ?? 0,
      vol0: muted ? 0 : volume,
      bright0: brightness,
      value: 0,
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    lastPointer.current = e.pointerType
    const g = gesture.current
    if (!g || e.pointerId !== g.id) return
    const dx = e.clientX - g.x0
    const dy = e.clientY - g.y0

    if (g.mode === 'pending') {
      if (Math.hypot(dx, dy) < SWIPE_SLOP) return
      if (Math.abs(dx) > Math.abs(dy)) g.mode = 'seek'
      else if (fullscreen) g.mode = g.x0 - g.left < g.w / 2 ? 'brightness' : 'volume'
      else {
        gesture.current = null
        return
      }
      // A drag is not a tap; don't let it complete a pending double tap.
      lastTap.current = null
      clearTimeout(tapTimer.current)
    }

    if (g.mode === 'seek') {
      const total = dur || videoRef.current?.duration || 0
      const span = Math.min(total, SCRUB_SPAN)
      const target = clamp(g.time0 + (dx / g.w) * span, 0, total)
      g.value = target
      setGestureHud({ kind: 'seek', target, delta: target - g.time0 })
    } else if (g.mode === 'volume') {
      const value = clamp(g.vol0 - (dy / g.h) * 1.2, 0, 1)
      g.value = value
      setVolume(value)
      setMuted(false)
      setGestureHud({ kind: 'volume', value })
    } else {
      const value = clamp(g.bright0 - (dy / g.h) * 1.2, 0.2, 1)
      g.value = value
      setBrightness(value)
      setGestureHud({ kind: 'brightness', value })
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current
    gesture.current = null
    if (!g || e.pointerId !== g.id) return

    if (g.mode === 'seek') {
      seekTo(g.value)
      setGestureHud(null)
      setShowControls(true)
      showControlsBriefly()
      return
    }
    if (g.mode !== 'pending') {
      setGestureHud(null)
      return
    }

    const now = performance.now()
    const prev = lastTap.current
    const isDouble =
      prev && now - prev.t < DOUBLE_TAP_MS && Math.abs(e.clientX - prev.x) < 48 && Math.abs(e.clientY - prev.y) < 48

    if (isDouble) {
      clearTimeout(tapTimer.current)
      lastTap.current = null
      const x = e.clientX - g.left
      const v = videoRef.current
      if (x < g.w / 3) {
        seekTo((v?.currentTime ?? 0) - 10)
        setSeekFlash({ id: now, dir: -1 })
      } else if (x > (g.w * 2) / 3) {
        seekTo((v?.currentTime ?? 0) + 10)
        setSeekFlash({ id: now, dir: 1 })
      } else {
        toggle()
      }
      return
    }

    // A single tap only counts once no second tap follows.
    lastTap.current = { t: now, x: e.clientX, y: e.clientY }
    clearTimeout(tapTimer.current)
    tapTimer.current = window.setTimeout(() => {
      lastTap.current = null
      if (hoveredRef.current) {
        setHovered(null)
        danmakuRef.current?.freeze(null)
        return
      }
      setShowControls((s) => !s)
      showControlsBriefly()
    }, DOUBLE_TAP_MS)
  }

  const onPointerCancel = (e: React.PointerEvent) => {
    if (gesture.current?.id !== e.pointerId) return
    // The browser took the touch over (usually to scroll); nothing is applied.
    gesture.current = null
    setGestureHud(null)
  }

  useEffect(() => () => clearTimeout(tapTimer.current), [])

  /* Keyboard shortcuts, scoped so they never fire while typing a comment. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          toggle()
          break
        case 'ArrowLeft':
          seekTo((videoRef.current?.currentTime ?? 0) - 5)
          break
        case 'ArrowRight':
          seekTo((videoRef.current?.currentTime ?? 0) + 5)
          break
        case 'ArrowUp':
          setVolume((v) => Math.min(1, v + 0.1))
          break
        case 'ArrowDown':
          setVolume((v) => Math.max(0, v - 0.1))
          break
        case 'f':
          toggleFullscreen()
          break
        case 'd':
          setDanmakuOn((d) => !d)
          break
        case 'm':
          setMuted((m) => !m)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  useEffect(() => localStorage.setItem('bili.volume', String(volume)), [volume])
  useEffect(() => localStorage.setItem('bili.dmArea', String(dmArea)), [dmArea])
  useEffect(() => localStorage.setItem('bili.dmOpacity', String(dmOpacity)), [dmOpacity])
  useEffect(() => localStorage.setItem('bili.dmScale', String(dmScale)), [dmScale])
  useEffect(() => localStorage.setItem('bili.dmNoOverlap', dmNoOverlap ? '1' : '0'), [dmNoOverlap])
  useEffect(() => localStorage.setItem('bili.dmFsSyncOn', dmFsSync ? '1' : '0'), [dmFsSync])

  /**
   * bilibili syncs danmaku preferences with the account. Until the user changes
   * a danmaku setting here, mirror those, so BiliNext starts out at the same
   * size, opacity and area as the official client.
   */
  const { data: accountDm } = useQuery<{
    setting: null | { opacity?: number; area?: number; fontsize?: number; fullscreenSync?: boolean }
  }>({
    queryKey: ['dmAccountSetting'],
    enabled: Boolean(oid && aid),
    queryFn: () => api.get('/api/danmaku/setting', { params: { cid: oid, aid } }),
    staleTime: 30 * 60 * 1000,
    retry: false,
  })
  useEffect(() => {
    const s = accountDm?.setting
    if (!s || localStorage.getItem('bili.dmCustom') === '1') return
    if (s.fontsize) setDmScale(s.fontsize)
    if (s.opacity) setDmOpacity(s.opacity)
    if (s.area) setDmArea(Math.min(1, Math.max(0.25, s.area)))
  }, [accountDm])
  /** A danmaku setting changed by hand here takes precedence over the account's. */
  const markCustom = () => localStorage.setItem('bili.dmCustom', '1')
  useEffect(() => {
    localStorage.setItem('bili.danmaku', danmakuOn ? 'on' : 'off')
    if (!danmakuOn) {
      setHovered(null)
      danmakuRef.current?.freeze(null)
    }
  }, [danmakuOn])

  // A new source means the old element state is meaningless.
  useEffect(() => {
    setTime(0)
    setBuffered(0)
    setPlaying(false)
    setStarted(false)
    setAudioBlocked(false)
  }, [videoTrack?.url, progressiveUrl])

  /* ---------------------------------------------------- resume and reporting */

  useEffect(() => setResumeNote(null), [oid])

  /**
   * Jumps to where the account last stopped, once per part. Needs the duration,
   * so it runs both when the position arrives and when metadata loads,
   * whichever is later.
   */
  const applyStart = useCallback(() => {
    const v = videoRef.current
    const key = oid === undefined ? null : String(oid)
    if (!v || !key || startAt === undefined || !v.duration || appliedStartFor.current === key) return
    appliedStartFor.current = key
    // As bilibili does: the first seconds are not worth resuming, and a
    // position at the very end means it was finished -- start it over.
    if (startAt < 5 || startAt > v.duration - 5) return
    // The user already moved the playhead; don't yank it back.
    if (v.currentTime > 3) return
    v.currentTime = startAt
    syncAudio(true)
    setResumeNote(startAt)
  }, [oid, startAt, syncAudio])
  useEffect(() => applyStart(), [applyStart])

  useEffect(() => {
    if (resumeNote === null) return
    const id = setTimeout(() => setResumeNote(null), 6000)
    return () => clearTimeout(id)
  }, [resumeNote])

  // Periodic reports while playing, like bilibili's player, so a crash or a
  // killed app loses at most this much.
  useEffect(() => {
    if (!playing) return
    const id = setInterval(flushProgress, 15_000)
    return () => clearInterval(id)
  }, [playing, flushProgress])

  // On a phone, going to the background is the last reliable moment: the app
  // may be killed afterwards without another event. Unmount covers leaving
  // the video page inside the app.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushProgress()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      flushProgress()
    }
  }, [flushProgress])

  const pct = dur ? (time / dur) * 100 : 0
  const bufPct = dur ? (buffered / dur) * 100 : 0

  return (
    <div
      ref={wrapRef}
      className="relative bg-black w-full aspect-video overflow-hidden group/player select-none"
      style={{ touchAction: fullscreen ? 'none' : 'pan-y' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onMouseMove={(e) => {
        // A tap also emits a compatibility mousemove, which would force the
        // controls back on right after a tap that hid them.
        if (lastPointer.current === 'touch') return
        nudgeControls()
        trackDanmaku(e)
      }}
      onMouseLeave={() => {
        if (playing) setShowControls(false)
        // The danmaku menu deliberately survives the pointer leaving.
        dismissedRef.current = null
      }}
      onClick={(e) => {
        // Touch taps are resolved by the gesture handlers (tap vs double tap).
        if (lastPointer.current === 'touch') return
        const blank = e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'VIDEO'
        if (!blank) return
        // With a danmaku menu open, a click on empty video only dismisses it;
        // pausing as a side effect of closing a menu would be surprising.
        if (hovered) return closeMenu()
        toggle()
      }}
    >
      <video
        ref={videoRef}
        src={videoTrack?.url ?? progressiveUrl}
        poster={poster}
        playsInline
        preload="metadata"
        className="w-full h-full"
        style={brightness < 1 ? { filter: `brightness(${brightness})` } : undefined}
        onLoadedMetadata={() => applyStart()}
        onEmptied={onEmptied}
        onPlay={onPlay}
        onPause={onPause}
        onTimeUpdate={onTimeUpdate}
        onDurationChange={(e) => setDur((e.target as HTMLVideoElement).duration)}
        onWaiting={onWaiting}
        onPlaying={onPlaying}
        onEnded={onEnded}
        onSeeked={() => syncAudio(true)}
        onRateChange={(e) => {
          if (audioRef.current) audioRef.current.playbackRate = (e.target as HTMLVideoElement).playbackRate
        }}
      />
      {hasSeparateAudio && <audio ref={audioRef} src={audioTrack!.url} preload="metadata" />}

      {danmakuOn && (
        <DanmakuLayer
          ref={danmakuRef}
          items={danmaku}
          currentTime={time}
          playing={playing && !waiting}
          area={dmArea}
          opacity={dmOpacity}
          fontScale={dmScale}
          allowOverlap={!dmNoOverlap}
          fullscreenSync={dmFsSync}
        />
      )}

      {danmakuOn && hovered && oid && (
        <DanmakuMenu
          hit={hovered}
          oid={oid}
          containerRef={wrapRef}
          onClose={closeMenu}
        />
      )}

      {audioBlocked && playing && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            enableAudio()
          }}
          className="absolute top-3 left-3 z-20 flex items-center gap-2 h-9 px-3.5 rounded-full bg-black/75 backdrop-blur-sm text-white text-[13px] font-medium hover:bg-black/90 transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-[17px] h-[17px]" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6.5 9H3v6h3.5L11 19z" />
            <path d="m15.5 9.5 4 5m0-5-4 5" />
          </svg>
          點擊開啟聲音
        </button>
      )}

      {waiting && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="w-10 h-10 rounded-full border-[3px] border-white/25 border-t-white animate-spin" />
        </div>
      )}

      {/* Only the very first frame gets a solid call-to-action over the poster. */}
      {!started && !waiting && (
        <button
          onClick={toggle}
          aria-label="播放"
          className="absolute inset-0 grid place-items-center"
        >
          <span className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm grid place-items-center">
            <svg viewBox="0 0 24 24" className="w-7 h-7 ml-1 fill-white">
              <path d="M6 4.5v15l13-7.5z" />
            </svg>
          </span>
        </button>
      )}

      {/* Afterwards, toggling only pops this flourish -- the frame stays visible. */}
      {started && pop && (
        <span
          key={pop.id}
          onAnimationEnd={() => setPop(null)}
          className="toggle-pop absolute left-1/2 top-1/2 -ml-8 -mt-8 w-16 h-16 rounded-full bg-black/55 grid place-items-center pointer-events-none"
        >
          {pop.kind === 'play' ? (
            <svg viewBox="0 0 24 24" className="w-7 h-7 ml-1 fill-white">
              <path d="M6 4.5v15l13-7.5z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white">
              <path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" />
            </svg>
          )}
        </span>
      )}

      {gestureHud && (
        <div className="absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none rounded-xl bg-black/70 px-5 py-3 text-white text-center">
          {gestureHud.kind === 'seek' ? (
            <>
              <div className="text-xl font-semibold tabular-nums">
                {fmt(gestureHud.target)}
                <span className="text-white/55 font-normal"> / {fmt(dur)}</span>
              </div>
              <div className="text-xs text-white/70 tabular-nums mt-0.5">
                {gestureHud.delta >= 0 ? '+' : '−'}
                {Math.round(Math.abs(gestureHud.delta))} 秒
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3">
              {gestureHud.kind === 'volume' ? (
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 5 6.5 9H3v6h3.5L11 19z" />
                  {gestureHud.value > 0 ? <path d="M15 9.2a4 4 0 0 1 0 5.6M17.8 6.5a8 8 0 0 1 0 11" /> : <path d="m15.5 9.5 4 5m0-5-4 5" />}
                </svg>
              ) : (
                <I.Sun className="w-5 h-5" />
              )}
              <span className="relative w-28 h-1 rounded-full bg-white/25 overflow-hidden">
                <span
                  className="absolute inset-y-0 left-0 bg-white rounded-full"
                  style={{ width: `${Math.round(gestureHud.value * 100)}%` }}
                />
              </span>
              <span className="text-sm tabular-nums w-9 text-right">{Math.round(gestureHud.value * 100)}%</span>
            </div>
          )}
        </div>
      )}

      {seekFlash && (
        <div
          key={seekFlash.id}
          onAnimationEnd={() => setSeekFlash(null)}
          className={`gesture-flash absolute inset-y-0 w-1/3 grid place-items-center pointer-events-none bg-white/10 ${
            seekFlash.dir < 0 ? 'left-0 rounded-r-[50%]' : 'right-0 rounded-l-[50%]'
          }`}
        >
          <span className="text-white text-sm font-medium drop-shadow">
            {seekFlash.dir < 0 ? '« 10 秒' : '10 秒 »'}
          </span>
        </div>
      )}

      {resumeNote !== null && (
        <div
          data-player-controls
          onClick={(e) => e.stopPropagation()}
          className="absolute left-3 bottom-16 z-20 flex items-center gap-1 h-9 pl-3.5 pr-1 rounded-full bg-black/75 backdrop-blur-sm text-white text-[13px]"
        >
          <span>已從上次看到的 {fmt(resumeNote)} 繼續播放</span>
          <button
            onClick={() => {
              seekTo(0)
              setResumeNote(null)
            }}
            className="h-7 px-2.5 rounded-full text-[var(--accent)] font-medium hover:bg-white/10"
          >
            從頭播放
          </button>
        </div>
      )}

      {/* Control bar */}
      <div
        data-player-controls
        className={`absolute inset-x-0 bottom-0 px-3 pb-2 pt-8 bg-gradient-to-t from-black/85 to-transparent transition-opacity duration-200 ${
          // Hidden controls must not catch taps: on touch the first tap should
          // reveal them, not press an invisible button.
          showControls || !playing ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Scrub bar */}
        <div
          className="relative h-4 flex items-center cursor-pointer group/bar"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            seekTo(((e.clientX - r.left) / r.width) * dur)
          }}
          role="slider"
          aria-label="播放進度"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur)}
          aria-valuenow={Math.round(time)}
          tabIndex={0}
        >
          <div className="relative h-1 w-full rounded-full bg-white/25 overflow-hidden group-hover/bar:h-1.5 transition-[height]">
            <div
              className="absolute inset-y-0 left-0 bg-white/35"
              style={{ width: `${bufPct}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 bg-[var(--accent)] rounded-full"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span
            className="absolute w-3 h-3 rounded-full bg-[var(--accent)] shadow -translate-x-1/2 opacity-0 group-hover/bar:opacity-100 transition-opacity"
            style={{ left: `${pct}%` }}
          />
        </div>

        <div className="flex items-center gap-1 sm:gap-2 text-white mt-0.5 min-w-0">
          <button onClick={toggle} aria-label={playing ? '暫停' : '播放'} className="p-1.5">
            {playing ? (
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                <path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
                <path d="M6 4.5v15l13-7.5z" />
              </svg>
            )}
          </button>

          <div className="flex items-center gap-1.5 group/vol">
            <button
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? '取消靜音' : '靜音'}
              className="p-1.5"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5 6.5 9H3v6h3.5L11 19z" />
                {muted || volume === 0 ? (
                  <path d="m15.5 9.5 4 5m0-5-4 5" />
                ) : (
                  <path d="M15 9.2a4 4 0 0 1 0 5.6M17.8 6.5a8 8 0 0 1 0 11" />
                )}
              </svg>
            </button>
            <div className="overflow-hidden w-0 group-hover/vol:w-16 focus-within:w-16 transition-[width] duration-200">
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={muted ? 0 : volume}
                aria-label="音量"
                onChange={(e) => {
                  setVolume(Number(e.target.value))
                  setMuted(false)
                }}
                className="w-16 block accent-[var(--accent)] cursor-pointer"
              />
            </div>
          </div>

          <span className="text-xs tabular-nums text-white/75 whitespace-nowrap">
            {fmt(time)} / {fmt(dur)}
          </span>

          <div className="flex-1 min-w-2" />

          <button
            onClick={() => setDanmakuOn((d) => !d)}
            className="flex items-center gap-1.5 px-2 py-1 text-xs rounded font-medium text-white hover:bg-white/10 transition-colors"
            aria-pressed={danmakuOn}
            title={danmakuOn ? '關閉彈幕 (d)' : '開啟彈幕 (d)'}
          >
            <span
              className={`w-3.5 h-3.5 rounded-[3px] border grid place-items-center transition-colors ${
                danmakuOn
                  ? 'bg-[var(--accent)] border-[var(--accent)]'
                  : 'border-white/55 bg-transparent'
              }`}
            >
              {danmakuOn && (
                <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="#fff" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12.5 5 5L19 7" />
                </svg>
              )}
            </span>
            彈幕
          </button>

          <div className="relative">
            <button
              onClick={() => setMenu(menu === 'danmaku' ? 'none' : 'danmaku')}
              aria-label="彈幕設定"
              className="w-7 h-7 grid place-items-center rounded hover:bg-white/10"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.1 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14.6a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.4V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3Z" />
              </svg>
            </button>
            {menu === 'danmaku' && (
              <div className="absolute bottom-9 right-0 surface rounded-lg p-3 w-52 shadow-xl space-y-3 text-xs">
                <label className="block">
                  <span className="flex justify-between mb-1">
                    <span>顯示區域</span>
                    <span className="dim tabular-nums">{Math.round(dmArea * 100)}%</span>
                  </span>
                  <input
                    type="range"
                    min={0.25}
                    max={1}
                    step={0.05}
                    value={dmArea}
                    onChange={(e) => (markCustom(), setDmArea(Number(e.target.value)))}
                    className="w-full accent-[var(--accent)]"
                  />
                </label>
                <label className="block">
                  <span className="flex justify-between mb-1">
                    <span>不透明度</span>
                    <span className="dim tabular-nums">{Math.round(dmOpacity * 100)}%</span>
                  </span>
                  <input
                    type="range"
                    min={0.2}
                    max={1}
                    step={0.05}
                    value={dmOpacity}
                    onChange={(e) => (markCustom(), setDmOpacity(Number(e.target.value)))}
                    className="w-full accent-[var(--accent)]"
                  />
                </label>
                <label className="block">
                  <span className="flex justify-between mb-1">
                    <span>字體大小</span>
                    <span className="dim tabular-nums">{Math.round(dmScale * 100)}%</span>
                  </span>
                  <input
                    type="range"
                    min={0.6}
                    max={1.6}
                    step={0.05}
                    value={dmScale}
                    onChange={(e) => (markCustom(), setDmScale(Number(e.target.value)))}
                    className="w-full accent-[var(--accent)]"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span>防止重疊</span>
                  <input
                    type="checkbox"
                    checked={dmNoOverlap}
                    onChange={(e) => setDmNoOverlap(e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span>全螢幕同步縮放</span>
                  <input
                    type="checkbox"
                    checked={dmFsSync}
                    onChange={(e) => (markCustom(), setDmFsSync(e.target.checked))}
                    className="accent-[var(--accent)]"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => setMenu(menu === 'speed' ? 'none' : 'speed')}
              className="px-2 py-1 text-xs rounded hover:bg-white/10"
            >
              {rate}x
            </button>
            {menu === 'speed' && (
              <div className="absolute bottom-9 right-0 surface rounded-lg py-1 min-w-[84px] shadow-xl">
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                  <button
                    key={r}
                    onClick={() => {
                      setRate(r)
                      setMenu('none')
                    }}
                    className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--surface-2)] ${
                      r === rate ? 'text-[var(--accent)]' : ''
                    }`}
                  >
                    {r}x
                  </button>
                ))}
              </div>
            )}
          </div>

          {play?.acceptQuality?.length ? (
            <div className="relative">
              <button
                onClick={() => setMenu(menu === 'quality' ? 'none' : 'quality')}
                className="px-2 py-1 text-xs rounded hover:bg-white/10"
              >
                {QN_LABEL[quality ?? 0] ?? '畫質'}
              </button>
              {menu === 'quality' && (
                <div className="absolute bottom-9 right-0 surface rounded-lg py-1 min-w-[110px] shadow-xl max-h-56 overflow-y-auto">
                  {play.acceptQuality.map((qn, i) => (
                    <button
                      key={qn}
                      onClick={() => {
                        onQualityChange?.(qn)
                        setMenu('none')
                      }}
                      className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--surface-2)] ${
                        qn === quality ? 'text-[var(--accent)]' : ''
                      }`}
                    >
                      {play.acceptDescription?.[i] ?? QN_LABEL[qn] ?? qn}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <button
            onClick={() => videoRef.current?.requestPictureInPicture?.().catch(() => {})}
            aria-label="子母畫面"
            className="p-1.5 hidden sm:block"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <rect x="12.5" y="11.5" width="6.5" height="5.5" rx="1" fill="currentColor" />
            </svg>
          </button>

          {onToggleWide && (
            <button
              onClick={onToggleWide}
              aria-label={wide ? '退出寬螢幕' : '寬螢幕'}
              title={wide ? '退出寬螢幕' : '寬螢幕'}
              aria-pressed={wide}
              className={`p-1.5 hidden lg:block ${wide ? 'text-[var(--accent)]' : ''}`}
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
                <rect x="2.5" y="6" width="19" height="12" rx="2" />
                {wide ? <path d="M9 10.5h6v3H9z" fill="currentColor" stroke="none" /> : null}
              </svg>
            </button>
          )}

          <button onClick={toggleFullscreen} aria-label="全螢幕" className="p-1.5">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </svg>
          </button>
        </div>
      </div>

      {title && showControls && (
        <div className="absolute top-0 inset-x-0 p-3 bg-gradient-to-b from-black/70 to-transparent text-white text-sm font-medium truncate pointer-events-none">
          {title}
        </div>
      )}
    </div>
  )
})

export default Player
