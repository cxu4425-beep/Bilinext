import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { useApp } from '@/store/app'
import { count } from '@/lib/format'
import type { DanmakuHit } from './DanmakuLayer'

/** Rough rendered width, used to keep the toolbar inside the frame. */
const MENU_WIDTH = 200
const MENU_HEIGHT = 48

/**
 * The toolbar bilibili shows on a danmaku: like it, copy the text, or report
 * it. It stays open after the pointer leaves -- the player closes it on a click
 * on empty video, Escape, or a seek -- so the buttons can be reached without
 * chasing the text. Like counts are not in the danmaku stream, so they are
 * fetched for the one danmaku the menu is showing rather than for all of them.
 */
export default function DanmakuMenu({
  hit,
  oid,
  onClose,
  containerRef,
}: {
  hit: DanmakuHit
  oid: number | string
  onClose: () => void
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  const [likes, setLikes] = useState<number | null>(null)
  const [liked, setLiked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const { loggedIn, toast } = useApp()

  useEffect(() => {
    let cancelled = false
    setLikes(null)
    setLiked(false)
    setCopied(false)
    api
      .get('/api/danmaku/stats', { params: { oid, ids: hit.dmid } })
      .then((r) => {
        if (cancelled) return
        const s = r.stats?.[hit.dmid]
        setLikes(s?.likes ?? 0)
        setLiked(Boolean(s?.liked))
      })
      .catch(() => !cancelled && setLikes(0))
    return () => {
      cancelled = true
    }
  }, [hit.dmid, oid])

  const like = async () => {
    if (!loggedIn) return toast('請先登入', 'error')
    if (busy) return
    const next = !liked
    setBusy(true)
    setLiked(next)
    setLikes((n) => (n ?? 0) + (next ? 1 : -1))
    try {
      await api.post('/api/danmaku/like', { oid, dmid: hit.dmid, on: next })
    } catch (err: any) {
      setLiked(!next)
      setLikes((n) => (n ?? 0) + (next ? -1 : 1))
      toast(err.message || '操作失敗', 'error')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hit.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast('無法複製', 'error')
    }
  }

  const report = async () => {
    if (!loggedIn) return toast('請先登入', 'error')
    // Reporting is visible to moderators and cannot be taken back.
    if (!window.confirm(`確定要檢舉這則彈幕嗎?\n\n「${hit.text}」`)) return
    try {
      await api.post('/api/danmaku/report', { cid: oid, dmid: hit.dmid, reason: 2, confirm: true })
      toast('已送出檢舉', 'ok')
      onClose()
    } catch (err: any) {
      toast(err.message || '檢舉失敗', 'error')
    }
  }

  const width = containerRef.current?.clientWidth ?? 0
  // Keep the toolbar inside the frame when the danmaku is near an edge.
  const left = Math.min(Math.max(hit.x, 6), Math.max(6, width - MENU_WIDTH - 6))
  const above = hit.y > MENU_HEIGHT + 8
  const top = above ? hit.y - MENU_HEIGHT - 4 : hit.y + hit.h + 8

  const iconCls = 'w-5 h-5'

  return (
    <div
      data-danmaku-menu
      role="toolbar"
      aria-label="彈幕操作"
      className="absolute z-20 flex items-center gap-1 rounded-[10px] bg-black/80 backdrop-blur-sm px-1.5 py-1 shadow-xl ring-1 ring-white/10"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={like}
        disabled={busy}
        title={liked ? '取消讚' : '讚'}
        className={`flex items-center gap-1.5 h-10 px-3 rounded-lg text-[15px] transition-colors hover:bg-white/10 ${
          liked ? 'text-[var(--accent-strong)]' : 'text-white/90 hover:text-white'
        }`}
      >
        <svg viewBox="0 0 24 24" className={iconCls} fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 21V10l4.2-7a2 2 0 0 1 2.9 2.4L13 9h5.6a2 2 0 0 1 2 2.4l-1.4 7A2.5 2.5 0 0 1 16.7 21Z" />
          <path d="M7 10H4v11h3" />
        </svg>
        <span className="tabular-nums min-w-[1.5ch]">{likes === null ? '…' : count(likes)}</span>
      </button>

      <span className="w-px h-5 bg-white/20" />

      <button
        onClick={copy}
        title="複製彈幕"
        className={`w-10 h-10 grid place-items-center rounded-lg transition-colors hover:bg-white/10 ${
          copied ? 'text-emerald-400' : 'text-white/90 hover:text-white'
        }`}
      >
        {copied ? (
          <svg viewBox="0 0 24 24" className={iconCls} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12.5 5 5L19 7" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h8" />
          </svg>
        )}
      </button>

      <span className="w-px h-5 bg-white/20" />

      <button
        onClick={report}
        title="檢舉彈幕"
        className="w-10 h-10 grid place-items-center rounded-lg text-white/90 hover:text-red-400 hover:bg-white/10 transition-colors"
      >
        <svg viewBox="0 0 24 24" className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v5.5M12 16.2h.01" />
        </svg>
      </button>
    </div>
  )
}
