import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '@/api/client'
import { useApp } from '@/store/app'
import { count, timeAgo } from '@/lib/format'
import Player, { type PlayerHandle, type PlayData } from '@/components/Player'
import CommentSection from '@/components/CommentSection'
import VideoCard from '@/components/VideoCard'
import FavouriteDialog from '@/components/FavouriteDialog'
import QueryState from '@/components/QueryState'
import * as I from './../components/Icons'

type Detail = {
  bvid: string
  aid: number
  cid: number
  title: string
  desc: string
  cover: string
  pubdate: number
  stat: { view: number; danmaku: number; like: number; coin: number; favorite: number; share: number; reply: number }
  pages: { cid: number; page: number; title: string; duration: number }[]
  owner: { mid: number; name: string; face: string; fans?: number }
  me: {
    liked: boolean
    disliked: boolean
    favoured: boolean
    coined: number
    following: boolean
    watchLater: boolean
  }
  related: any[]
}

function Action({
  icon,
  label,
  active,
  onClick,
  activeClass = 'text-[var(--accent)]',
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick: () => void
  activeClass?: string
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-center gap-1 min-w-[58px] py-1.5 rounded-lg hover:bg-[var(--surface-2)] transition-colors ${
        active ? activeClass : 'dim'
      }`}
    >
      {icon}
      <span className="text-[11px] tabular-nums">{label}</span>
    </button>
  )
}

export default function VideoPage() {
  const { bvid = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const playerRef = useRef<PlayerHandle>(null)
  const [quality, setQuality] = useState<number>(() =>
    Number(localStorage.getItem('bili.quality') || 80),
  )
  /**
   * "normal" puts the player top-left with the related list beside it, which is
   * how bilibili lays the page out. "wide" spans the player across the full
   * width and pushes everything below it.
   */
  const [wide, setWide] = useState(() => localStorage.getItem('bili.wide') === '1')
  // Default on; opening a video is normally the result of a click, which is the
  // user gesture the browser needs to allow sound.
  const autoPlay = localStorage.getItem('bili.autoplay') !== '0'
  const [favOpen, setFavOpen] = useState(false)
  const [coinOpen, setCoinOpen] = useState(false)
  const { loggedIn, ready, toast } = useApp()
  const qc = useQueryClient()

  const { data: v, isLoading, error, refetch } = useQuery<Detail>({
    queryKey: ['video', bvid],
    queryFn: () => api.get(`/api/video/${bvid}`),
    // Same rule as the global default, plus: a video that does not exist will
    // not start existing on the second try, so don't make the reader wait for
    // two more round trips before saying so.
    retry: (count, err: any) =>
      !err?.needsLogin && !err?.riskControlled && !err?.offline && err?.code !== -404 && count < 2,
  })

  const page = Number(params.get('p') || 1)
  const cid = v?.pages?.[page - 1]?.cid ?? v?.cid

  const { data: play } = useQuery<PlayData>({
    queryKey: ['playurl', bvid, cid, quality],
    enabled: Boolean(bvid && cid),
    queryFn: () => api.get(`/api/video/${bvid}/playurl`, { params: { cid, qn: quality } }),
    staleTime: 0,
  })

  const { data: danmaku } = useQuery({
    queryKey: ['danmaku', cid],
    enabled: Boolean(cid),
    // The part's length tells the server how many six-minute segments to read.
    queryFn: () =>
      api.get(`/api/video/${bvid}/danmaku`, {
        params: { cid, duration: v?.pages?.[page - 1]?.duration ?? v?.pages?.[0]?.duration },
      }),
    staleTime: 10 * 60 * 1000,
  })

  /**
   * Where the account last stopped. Never cached: after watching a while and
   * coming back, a remembered answer would resume at the old spot.
   */
  const resume = useQuery<{ cid: number | null; seconds: number }>({
    queryKey: ['resume', bvid, cid],
    enabled: Boolean(loggedIn && bvid && cid),
    queryFn: () => api.get(`/api/video/${bvid}/resume`, { params: { cid } }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
  // undefined holds the player back until the answer is in; 0 means "nothing
  // to resume" -- signed out, lookup failed, or the position was on another part.
  // The player applies the first definite answer and ignores later ones, so
  // "signed out" must wait for the login check: before it finishes loggedIn
  // reads false for everyone, and a 0 sent then would lock resume out.
  const startAt = (() => {
    if (!ready) return undefined
    if (!loggedIn || resume.isError) return 0
    if (!resume.isSuccess) return undefined
    return resume.data.cid === cid ? resume.data.seconds : 0
  })()

  const reportProgress = useCallback(
    ({ aid, cid, seconds }: { aid: number; cid: number | string; seconds: number }) => {
      api
        .post('/api/history/progress', { aid, cid, progress: seconds }, { keepalive: true })
        .then(() => qc.invalidateQueries({ queryKey: ['history'] }))
        // Losing one progress report is harmless; the next one supersedes it.
        .catch(() => {})
    },
    [qc],
  )

  /**
   * The watch-later list is read back a few seconds behind writes, so
   * re-fetching after a toggle would show the old state and flip the button
   * straight back. The write's own result is shown instead.
   */
  const [watchLater, setWatchLater] = useState<boolean | null>(null)
  useEffect(() => setWatchLater(null), [bvid])
  const toggleWatchLater = async () => {
    if (!guard() || !v) return
    const next = !(watchLater ?? v.me.watchLater)
    setWatchLater(next)
    try {
      await api.post(next ? '/api/me/watchlater' : '/api/me/watchlater/remove', { aid: v.aid })
      toast(next ? '已加入稍後再看' : '已從稍後再看移除', 'ok')
      qc.invalidateQueries({ queryKey: ['watchlater'], refetchType: 'none' })
    } catch (err: any) {
      setWatchLater(!next)
      toast(err.message || '操作失敗', 'error')
    }
  }

  // The comment composer's "stamp time" button needs the live playhead without
  // threading a ref through every layer between them.
  useEffect(() => {
    ;(window as any).__biliPlayerTime = () => playerRef.current?.currentTime() ?? 0
    return () => {
      delete (window as any).__biliPlayerTime
    }
  }, [])

  useEffect(() => {
    if (v?.title) document.title = `${v.title} - BiliNext`
    return () => {
      document.title = 'BiliNext'
    }
  }, [v?.title])

  const guard = () => {
    if (!loggedIn) {
      toast('請先登入才能操作', 'error')
      return false
    }
    return true
  }

  const toggleWide = () => {
    setWide((w) => {
      localStorage.setItem('bili.wide', w ? '0' : '1')
      return !w
    })
  }

  const refresh = () => qc.invalidateQueries({ queryKey: ['video', bvid] })

  const act = async (fn: () => Promise<unknown>, okMessage: string) => {
    if (!guard()) return
    try {
      await fn()
      toast(okMessage, 'ok')
      refresh()
    } catch (err: any) {
      toast(err.message || '操作失敗', 'error')
    }
  }

  /**
   * A failed lookup used to fall into the skeleton below and spin for ever,
   * because the branch only asked whether the data was there. Videos that are
   * deleted, private or blocked in your region answer -404 ("啥都木有"), which
   * is a normal thing to hit from an old favourite or a watch-later entry.
   */
  if (error) {
    const e = error as ApiError
    const gone = e?.code === -404 || e?.status === 404
    return (
      <div className="p-3 sm:p-5">
        <QueryState
          error={
            gone
              ? new ApiError(404, { error: '這部影片不存在、已被刪除,或是你的地區看不到。' })
              : error
          }
          onRetry={gone ? undefined : () => refetch()}
        />
        <p className="text-center">
          <Link to="/" className="text-xs dim hover:text-[var(--accent)] transition-colors">
            回首頁
          </Link>
        </p>
      </div>
    )
  }

  if (isLoading || !v) {
    return (
      <div className="p-3 sm:p-5">
        <div className="skeleton aspect-video rounded-[var(--radius-card)] max-w-5xl" />
      </div>
    )
  }

  const player = (
    <>
      <Player
        ref={playerRef}
        play={play}
        danmaku={danmaku?.items}
        poster={v.cover}
        quality={quality}
        oid={cid}
        aid={v.aid}
        autoPlay={autoPlay}
        startAt={startAt}
        onProgress={loggedIn ? reportProgress : undefined}
        wide={wide}
        onToggleWide={toggleWide}
        onQualityChange={(qn) => {
          setQuality(qn)
          localStorage.setItem('bili.quality', String(qn))
        }}
      />
      {/* Danmaku composer, directly under the player like bilibili's own. */}
      <div className="bg-[var(--surface)] border-x border-b border-[var(--border)] rounded-b-lg px-3 py-2">
        <DanmakuBar
          bvid={bvid}
          cid={cid}
          aid={v.aid}
          getTime={() => playerRef.current?.currentTime() ?? 0}
        />
      </div>
    </>
  )

  return (
    <div className="pb-8">
      {/* Wide mode only: the player breaks out above the two-column body. */}
      {wide && (
        <div className="bg-black mb-4">
          <div className="mx-auto max-w-[1600px]">{player}</div>
        </div>
      )}

      <div className="mx-auto max-w-[1400px] px-3 sm:px-5 mt-4 flex flex-col lg:flex-row gap-5">
        <div className="flex-1 min-w-0">
          {!wide && <div className="mb-3 -mx-3 sm:mx-0">{player}</div>}

          <h1 className="text-lg sm:text-xl font-bold leading-snug">{v.title}</h1>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] dim">
            <span>{count(v.stat?.view)} 次觀看</span>
            <span>{count(v.stat?.danmaku)} 彈幕</span>
            <span>{timeAgo(v.pubdate)}</span>
            <span className="font-mono">{v.bvid}</span>
          </div>

          {/* Multi-part videos */}
          {v.pages.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {v.pages.map((p) => (
                <button
                  key={p.cid}
                  onClick={() => setParams({ p: String(p.page) })}
                  className={`shrink-0 px-3 h-8 rounded-lg text-xs transition-colors ${
                    p.page === page
                      ? 'bg-[var(--accent)] text-white'
                      : 'surface hover:border-[var(--accent)]'
                  }`}
                >
                  P{p.page} {p.title}
                </button>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <Link to={`/user/${v.owner.mid}`} className="flex items-center gap-2.5 min-w-0">
              <img src={v.owner.face} alt="" className="w-11 h-11 rounded-full object-cover" />
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{v.owner.name}</div>
                {v.owner.fans !== undefined && (
                  <div className="text-[11px] dim">{count(v.owner.fans)} 粉絲</div>
                )}
              </div>
            </Link>
            <button
              onClick={() =>
                act(
                  () => api.post(`/api/user/${v.owner.mid}/follow`, { on: !v.me.following }),
                  v.me.following ? '已取消關注' : '已關注',
                )
              }
              className={`ml-auto h-9 px-4 rounded-full text-sm font-medium transition-colors ${
                v.me.following
                  ? 'surface hover:border-[var(--accent)]'
                  : 'bg-[var(--accent)] hover:bg-[var(--color-pink-deep)] text-white'
              }`}
            >
              {v.me.following ? '已關注' : '+ 關注'}
            </button>
          </div>

          {/* Reactions */}
          <div className="mt-4 flex items-center gap-1 surface rounded-[var(--radius-card)] p-1.5 overflow-x-auto">
            <Action
              icon={<I.ThumbUp filled={v.me.liked} />}
              label={count(v.stat?.like)}
              active={v.me.liked}
              onClick={() =>
                act(
                  () => api.post(`/api/video/${bvid}/like`, { on: !v.me.liked }),
                  v.me.liked ? '已取消讚' : '已按讚',
                )
              }
            />
            <Action
              icon={<I.ThumbDown filled={v.me.disliked} />}
              label="不喜歡"
              active={v.me.disliked}
              activeClass="text-[var(--color-cyan-brand)]"
              onClick={() =>
                act(
                  () => api.post(`/api/video/${bvid}/dislike`, { on: !v.me.disliked }),
                  v.me.disliked ? '已取消' : '已點踩',
                )
              }
            />
            <Action
              icon={<I.Coin filled={v.me.coined > 0} />}
              label={count(v.stat?.coin)}
              active={v.me.coined > 0}
              onClick={() => (guard() ? setCoinOpen(true) : null)}
            />
            <Action
              icon={<I.Star filled={v.me.favoured} />}
              label={count(v.stat?.favorite)}
              active={v.me.favoured}
              onClick={() => (guard() ? setFavOpen(true) : null)}
            />
            <Action
              icon={<I.Clock />}
              label="稍後再看"
              active={watchLater ?? v.me.watchLater}
              onClick={toggleWatchLater}
            />
            <Action
              icon={<I.Share />}
              label={count(v.stat?.share)}
              onClick={() => {
                const url = `https://www.bilibili.com/video/${bvid}`
                if (navigator.share) navigator.share({ title: v.title, url }).catch(() => {})
                else {
                  navigator.clipboard.writeText(url)
                  toast('連結已複製', 'ok')
                }
              }}
            />
            <button
              onClick={() => act(() => api.post(`/api/video/${bvid}/triple`), '一鍵三連完成')}
              className="ml-auto shrink-0 h-9 px-3 rounded-lg text-xs font-medium bg-[var(--accent)]/12 text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors"
            >
              一鍵三連
            </button>
          </div>

          {v.desc && (
            <details className="mt-4 surface rounded-[var(--radius-card)] p-4 text-sm leading-relaxed">
              <summary className="cursor-pointer dim text-xs mb-2">影片簡介</summary>
              <p className="whitespace-pre-wrap break-words">{v.desc}</p>
            </details>
          )}

          <CommentSection oid={v.aid} onSeek={(s) => playerRef.current?.seek(s)} />
        </div>

        <aside className="lg:w-[350px] shrink-0">
          <h2 className="font-bold mb-3 text-sm">相關推薦</h2>
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-x-3 gap-y-4">
            {v.related.slice(0, 20).map((r) => (
              <VideoCard key={r.bvid} v={r} />
            ))}
          </div>
        </aside>
      </div>

      {favOpen && (
        <FavouriteDialog
          aid={v.aid}
          bvid={v.bvid}
          alreadyFavoured={v.me.favoured}
          onClose={() => setFavOpen(false)}
          onDone={() => {
            setFavOpen(false)
            refresh()
          }}
        />
      )}

      {coinOpen && (
        <CoinDialog
          onClose={() => setCoinOpen(false)}
          already={v.me.coined}
          onConfirm={async (n, alsoLike) => {
            setCoinOpen(false)
            await act(
              () => api.post(`/api/video/${bvid}/coin`, { count: n, alsoLike }),
              `已投 ${n} 幣`,
            )
          }}
        />
      )}
    </div>
  )
}

/** Sends a danmaku pinned to the current playhead. */
function DanmakuBar({
  bvid,
  cid,
  aid,
  getTime,
}: {
  bvid: string
  cid?: number
  aid: number
  getTime: () => number
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const { loggedIn, toast } = useApp()

  const send = async () => {
    if (!text.trim() || busy || !cid) return
    setBusy(true)
    try {
      await api.post(`/api/video/${bvid}/danmaku`, {
        cid,
        aid,
        message: text.trim(),
        progress: getTime(),
      })
      setText('')
      toast('彈幕已送出', 'ok')
    } catch (err: any) {
      toast(err.message || '彈幕送出失敗', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && send()}
        maxLength={100}
        placeholder={loggedIn ? '發送彈幕(會標記在目前播放時間)' : '登入後可發送彈幕'}
        disabled={!loggedIn}
        className="input flex-1 disabled:opacity-50"
      />
      <button
        onClick={send}
        disabled={!loggedIn || !text.trim() || busy}
        className="px-4 h-9 rounded-lg bg-[var(--accent)] text-white text-sm font-medium shrink-0 disabled:opacity-40"
      >
        發送
      </button>
    </div>
  )
}

/** Coins are spent, not toggled, so this asks before committing. */
function CoinDialog({
  onClose,
  onConfirm,
  already,
}: {
  onClose: () => void
  onConfirm: (n: number, alsoLike: boolean) => void
  already: number
}) {
  const [n, setN] = useState(1)
  const [alsoLike, setAlsoLike] = useState(true)
  const remaining = Math.max(0, 2 - already)

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="surface rounded-[10px] p-5 w-full max-w-xs rise" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold mb-1">投幣支持</h3>
        <p className="text-xs dim mb-4">
          {remaining === 0 ? '這部影片已投滿 2 枚硬幣' : `本影片還可投 ${remaining} 枚`}
        </p>

        {remaining > 0 && (
          <>
            <div className="flex gap-2 mb-4">
              {Array.from({ length: remaining }, (_, i) => i + 1).map((v) => (
                <button
                  key={v}
                  onClick={() => setN(v)}
                  className={`flex-1 h-11 rounded-[var(--radius-card)] border text-sm font-medium transition-colors ${
                    n === v
                      ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border)]'
                  }`}
                >
                  {v} 幣
                </button>
              ))}
            </div>

            <label className="flex items-center gap-2 text-sm mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={alsoLike}
                onChange={(e) => setAlsoLike(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              同時點讚
            </label>
          </>
        )}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-9 rounded-lg surface text-sm">
            取消
          </button>
          <button
            onClick={() => onConfirm(n, alsoLike)}
            disabled={remaining === 0}
            className="flex-1 h-9 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-40"
          >
            確認投幣
          </button>
        </div>
      </div>
    </div>
  )
}
