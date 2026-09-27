import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api/client'
import { useApp } from '@/store/app'
import { count } from '@/lib/format'
import PollCard from './PollCard'
import CommentSection from './CommentSection'

export type RichNode =
  | { kind: 'text'; text: string }
  | { kind: 'topic'; text: string; url: string }
  | { kind: 'at'; text: string; mid: string }
  | { kind: 'emoji'; text: string; url: string; size: number }
  | { kind: 'link'; text: string; url: string }

export type Dynamic = {
  id: string
  type: string
  author: {
    mid: string | null
    name: string
    face: string
    pubTime: string
    pubAction: string
    /** bilibili's enum, verified against the follow list: 1 = following, 2 = not. */
    following?: number
  }
  text: RichNode[]
  title: string | null
  video: {
    bvid: string
    cover: string
    title: string
    durationText: string
    play: string
    danmaku: string
    badge: string
  } | null
  images: { src: string; width: number; height: number }[]
  live: { roomId?: string; title?: string; cover?: string; watching?: number; live?: boolean } | null
  stat: { forward: number; comment: number; like: number; liked: boolean }
  commentId: string | null
  commentType: number | null
  voteId: number | null
  orig: Dynamic | null
}

/** Topics and @mentions are the blue, clickable parts of a bilibili post. */
function RichText({ nodes }: { nodes: RichNode[] }) {
  if (!nodes?.length) return null
  return (
    <div className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">
      {nodes.map((n, i) => {
        if (n.kind === 'topic')
          return (
            <a
              key={i}
              href={n.url?.startsWith('//') ? `https:${n.url}` : n.url}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-bili-dark)] hover:underline"
            >
              {n.text}
            </a>
          )
        if (n.kind === 'at')
          return (
            <Link key={i} to={`/user/${n.mid}`} className="text-[var(--color-bili-dark)] hover:underline">
              {n.text}
            </Link>
          )
        if (n.kind === 'emoji')
          return (
            <img
              key={i}
              src={n.url}
              alt={n.text}
              title={n.text}
              loading="lazy"
              className="inline-block align-text-bottom mx-0.5"
              style={{ height: n.size > 1 ? '2.5em' : '1.4em' }}
            />
          )
        if (n.kind === 'link')
          return (
            <a
              key={i}
              href={n.url?.startsWith('//') ? `https:${n.url}` : n.url}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-bili-dark)] hover:underline"
            >
              {n.text}
            </a>
          )
        return <span key={i}>{n.text}</span>
      })}
    </div>
  )
}

function VideoBlock({ v }: { v: NonNullable<Dynamic['video']> }) {
  return (
    <Link
      to={`/video/${v.bvid}`}
      className="block mt-2.5 rounded-lg overflow-hidden bg-[var(--surface-2)] group"
    >
      <div className="relative aspect-video">
        <img
          src={v.cover}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
        />
        {v.durationText && (
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 text-white text-[11px] tabular-nums">
            {v.durationText}
          </span>
        )}
      </div>
      <div className="px-3 py-2">
        <p className="text-[13.5px] font-medium line-clamp-1 group-hover:text-[var(--accent)] transition-colors">
          {v.title}
        </p>
        <p className="text-[11px] dim mt-0.5">
          {v.play} 播放{v.danmaku ? ` · ${v.danmaku} 彈幕` : ''}
        </p>
      </div>
    </Link>
  )
}

function ImageGrid({ images }: { images: Dynamic['images'] }) {
  if (!images.length) return null
  // One image keeps its shape; several become a square grid, as bilibili does.
  if (images.length === 1) {
    return (
      <a href={images[0].src} target="_blank" rel="noreferrer" className="block mt-2.5">
        <img
          src={images[0].src}
          alt=""
          loading="lazy"
          className="rounded-lg max-h-[420px] object-contain bg-[var(--surface-2)]"
        />
      </a>
    )
  }
  const cols = images.length <= 4 ? 2 : 3
  return (
    <div className={`mt-2.5 grid gap-1.5 ${cols === 2 ? 'grid-cols-2' : 'grid-cols-3'} max-w-md`}>
      {images.slice(0, 9).map((p, i) => (
        <a key={i} href={p.src} target="_blank" rel="noreferrer">
          <img
            src={p.src}
            alt=""
            loading="lazy"
            className="aspect-square w-full object-cover rounded-lg"
          />
        </a>
      ))}
    </div>
  )
}

function LiveBlock({ live }: { live: NonNullable<Dynamic['live']> }) {
  const href = live.roomId ? `https://live.bilibili.com/${live.roomId}` : undefined
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="block mt-2.5 rounded-lg overflow-hidden bg-[var(--surface-2)]"
    >
      {live.cover && (
        <div className="relative aspect-video">
          <img src={live.cover} alt="" loading="lazy" className="w-full h-full object-cover" />
          {live.live && (
            <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-[var(--color-bili-dark)] text-white text-[10px] font-medium">
              直播中
            </span>
          )}
        </div>
      )}
      <div className="px-3 py-2">
        <p className="text-[13.5px] font-medium line-clamp-1">{live.title}</p>
        {live.watching ? <p className="text-[11px] dim mt-0.5">{count(live.watching)} 人看過</p> : null}
      </div>
    </a>
  )
}

/**
 * Offered on a quoted author you do not already follow, the way bilibili does
 * inside a forward card.
 */
function FollowButton({ mid, name }: { mid: string; name: string }) {
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const { loggedIn, toast } = useApp()

  if (!loggedIn || !mid) return null

  return (
    <button
      onClick={async (e) => {
        e.preventDefault()
        if (busy || done) return
        setBusy(true)
        try {
          await api.post(`/api/user/${mid}/follow`, { on: true })
          setDone(true)
          toast(`已關注 ${name}`, 'ok')
        } catch (err: any) {
          toast(err.message || '關注失敗', 'error')
        } finally {
          setBusy(false)
        }
      }}
      disabled={busy || done}
      className={`shrink-0 h-6 px-2.5 rounded text-[11px] font-medium transition-colors ${
        done
          ? 'dim border border-[var(--border)]'
          : 'bg-[var(--accent)] hover:bg-[var(--color-pink-deep)] text-white'
      }`}
    >
      {done ? '已關注' : busy ? '…' : '+ 關注'}
    </button>
  )
}

/** The body shared by a post and by the original inside a forward. */
function Body({ d, nested }: { d: Dynamic; nested?: boolean }) {
  return (
    <>
      {d.title && <p className="font-semibold text-[15px] mb-1">{d.title}</p>}
      <RichText nodes={d.text} />
      {d.video && <VideoBlock v={d.video} />}
      <ImageGrid images={d.images} />
      {d.live && <LiveBlock live={d.live} />}
      {d.voteId && !nested && (
        <div className="mt-2.5">
          <PollCard voteId={d.voteId} />
        </div>
      )}
    </>
  )
}

function Stat({
  icon,
  n,
  label,
  active,
  onClick,
  busy,
}: {
  icon: React.ReactNode
  n: number
  label: string
  active?: boolean
  onClick?: () => void
  busy?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      aria-pressed={active}
      title={label}
      className={`flex items-center gap-1.5 text-[13px] rounded px-1 -mx-1 py-0.5 transition-colors disabled:opacity-60 ${
        active ? 'text-[var(--accent)]' : 'dim hover:text-[var(--accent)]'
      }`}
    >
      {icon}
      {n > 0 ? count(n) : label}
    </button>
  )
}

/** Composer shown when reposting; a forward is a new post on your own feed. */
function RepostBox({ id, onDone }: { id: string; onDone: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useApp()

  return (
    <div className="mt-3 surface rounded-lg p-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="說點什麼(可留空)"
        className="w-full bg-transparent outline-none resize-none text-sm px-1"
      />
      <div className="flex justify-end gap-2 mt-1">
        <button onClick={onDone} className="h-8 px-3 rounded-lg text-sm dim">
          取消
        </button>
        <button
          onClick={async () => {
            setBusy(true)
            try {
              await api.post(`/api/dynamics/${id}/repost`, { text: text.trim() })
              toast('已轉發', 'ok')
              onDone()
            } catch (err: any) {
              toast(err.message || '轉發失敗', 'error')
            } finally {
              setBusy(false)
            }
          }}
          disabled={busy}
          className="h-8 px-4 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-40"
        >
          {busy ? '轉發中…' : '轉發'}
        </button>
      </div>
    </div>
  )
}

export default function DynamicCard({ d }: { d: Dynamic }) {
  const [liked, setLiked] = useState(d.stat.liked)
  const [likes, setLikes] = useState(d.stat.like)
  const [busy, setBusy] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [reposting, setReposting] = useState(false)
  const { loggedIn, toast } = useApp()

  const toggleLike = async () => {
    if (!loggedIn) return toast('請先登入', 'error')
    const next = !liked
    setBusy(true)
    setLiked(next)
    setLikes((n) => n + (next ? 1 : -1))
    try {
      await api.post(`/api/dynamics/${d.id}/like`, { on: next })
    } catch (err: any) {
      setLiked(!next)
      setLikes((n) => n + (next ? -1 : 1))
      toast(err.message || '操作失敗', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="surface rounded-[var(--radius-card)] px-5 pt-5 pb-3">
      <header className="flex items-start gap-3 mb-2.5">
        <Link to={`/user/${d.author.mid}`} className="shrink-0">
          <img
            src={d.author.face}
            alt=""
            loading="lazy"
            className="w-10 h-10 rounded-full object-cover"
          />
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            to={`/user/${d.author.mid}`}
            className="text-[14px] font-medium text-[var(--color-bili-dark)] hover:underline"
          >
            {d.author.name}
          </Link>
          <p className="text-[11.5px] dim">
            {d.author.pubTime}
            {d.author.pubAction ? ` · ${d.author.pubAction}` : ''}
          </p>
        </div>
      </header>

      <Body d={d} />

      {/* A forward shows the original quoted inside a recessed panel. */}
      {d.orig && (
        <div className="mt-2.5 rounded-lg bg-[var(--surface-2)] p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Link
              to={`/user/${d.orig.author.mid}`}
              className="text-[13px] text-[var(--color-bili-dark)] hover:underline truncate"
            >
              @{d.orig.author.name}
            </Link>
            {d.orig.author.following === 2 && d.orig.author.mid && (
              <FollowButton mid={d.orig.author.mid} name={d.orig.author.name} />
            )}
          </div>
          <Body d={d.orig} nested />
        </div>
      )}

      <footer className="flex items-center gap-8 mt-3 pt-1">
        <Stat
          label="轉發"
          n={d.stat.forward}
          onClick={() =>
            loggedIn ? setReposting((v) => !v) : toast('請先登入', 'error')
          }
          active={reposting}
          icon={
            <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5.5" r="2.3" />
              <circle cx="6" cy="12" r="2.3" />
              <circle cx="18" cy="18.5" r="2.3" />
              <path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1" />
            </svg>
          }
        />
        <Stat
          label="留言"
          n={d.stat.comment}
          onClick={() => setShowComments((v) => !v)}
          active={showComments}
          icon={
            <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 12a7.5 7.5 0 0 1-11 6.6L4 20l1.4-4.3A7.5 7.5 0 1 1 20 12Z" />
            </svg>
          }
        />
        <Stat
          label="讚"
          n={likes}
          onClick={toggleLike}
          active={liked}
          busy={busy}
          icon={
            <svg
              viewBox="0 0 24 24"
              className="w-[18px] h-[18px]"
              fill={liked ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 21V10l4.2-7a2 2 0 0 1 2.9 2.4L13 9h5.6a2 2 0 0 1 2 2.4l-1.4 7A2.5 2.5 0 0 1 16.7 21Z" />
              <path d="M7 10H4v11h3" />
            </svg>
          }
        />
      </footer>

      {reposting && <RepostBox id={d.id} onDone={() => setReposting(false)} />}

      {/* Dynamics carry their own comment target; a video post threads to the
          video's comments, a text post to the post's own. */}
      {showComments && d.commentId && (
        <div className="mt-2 pt-2 border-t border-[var(--border)]">
          <CommentSection oid={d.commentId} type={d.commentType ?? 11} />
        </div>
      )}
    </article>
  )
}

export function DynamicCardSkeleton() {
  return (
    <div className="surface rounded-[var(--radius-card)] p-4">
      <div className="flex gap-3 mb-3">
        <div className="skeleton w-10 h-10 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-3 w-28 rounded" />
          <div className="skeleton h-2.5 w-20 rounded" />
        </div>
      </div>
      <div className="skeleton aspect-video rounded-lg" />
    </div>
  )
}
