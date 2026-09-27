import { useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/api/client'
import { useApp } from '@/store/app'
import { count, timeAgo } from '@/lib/format'
import CommentText, { type Emotes } from './CommentText'
import Composer, { type Picture } from './Composer'
import * as I from './Icons'

export type Comment = {
  rpid: string
  oid: string
  root: string
  message: string
  emotes: Emotes
  pictures: { src: string; width: number; height: number }[]
  like: number
  liked: boolean
  ctime: number
  replyCount: number
  member: { mid: string; name: string; face: string; level?: number }
  replies: Comment[]
}

function CommentRow({
  c,
  oid,
  type,
  onSeek,
  depth = 0,
  onReplied,
}: {
  c: Comment
  oid: string
  type: number
  onSeek?: (s: number) => void
  depth?: number
  onReplied: () => void
}) {
  const [liked, setLiked] = useState(c.liked)
  const [likes, setLikes] = useState(c.like)
  const [replying, setReplying] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const { loggedIn, toast } = useApp()

  const toggleLike = async () => {
    if (!loggedIn) return toast('請先登入', 'error')
    // Optimistic: the counter should respond instantly, and a failure rolls back.
    const next = !liked
    setLiked(next)
    setLikes((n) => n + (next ? 1 : -1))
    try {
      await api.post('/api/comments/like', { oid, type, rpid: c.rpid, on: next })
    } catch (err: any) {
      setLiked(!next)
      setLikes((n) => n + (next ? -1 : 1))
      toast(err.message || '操作失敗', 'error')
    }
  }

  const sendReply = async (text: string, pictures: Picture[]) => {
    await api.post('/api/comments', {
      oid,
      type,
      message: text,
      root: c.root !== '0' ? c.root : c.rpid,
      parent: c.rpid,
      pictures,
    })
    setReplying(false)
    toast('已回覆', 'ok')
    onReplied()
  }

  const visibleReplies = showAll ? c.replies : c.replies.slice(0, 3)

  return (
    <div className={depth > 0 ? '' : 'py-4 border-b border-[var(--border)]'}>
      <div className="flex gap-3">
        <Link to={`/user/${c.member.mid}`} className="shrink-0">
          <img
            src={c.member.face}
            alt=""
            loading="lazy"
            className={`rounded-full object-cover ${depth ? 'w-6 h-6' : 'w-9 h-9'}`}
          />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <Link
              to={`/user/${c.member.mid}`}
              className="text-[13px] font-medium dim hover:text-[var(--accent)] transition-colors"
            >
              {c.member.name}
            </Link>
            {c.member.level !== undefined && (
              <span className="text-[10px] px-1 rounded bg-[var(--surface-2)] dim">
                LV{c.member.level}
              </span>
            )}
            <span className="text-[11px] dim">{timeAgo(c.ctime)}</span>
          </div>

          <div className="mt-1 text-sm leading-relaxed">
            <CommentText message={c.message} emotes={c.emotes} onSeek={onSeek} />
          </div>

          {c.pictures.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {c.pictures.map((p, i) => (
                <a key={i} href={p.src} target="_blank" rel="noreferrer">
                  <img
                    src={p.src}
                    alt=""
                    loading="lazy"
                    className="max-h-52 rounded-lg border border-[var(--border)] object-cover"
                  />
                </a>
              ))}
            </div>
          )}

          <div className="mt-1.5 flex items-center gap-4 text-[12px] dim">
            <button
              onClick={toggleLike}
              className={`flex items-center gap-1 hover:text-[var(--accent)] transition-colors ${
                liked ? 'text-[var(--accent)]' : ''
              }`}
              aria-pressed={liked}
            >
              <I.ThumbUp className="w-4 h-4" filled={liked} />
              {likes > 0 && count(likes)}
            </button>
            <button
              onClick={() => setReplying((r) => !r)}
              className="hover:text-[var(--accent)] transition-colors"
            >
              回覆
            </button>
          </div>

          {replying && (
            <div className="mt-2">
              <Composer
                onSubmit={sendReply}
                placeholder={`回覆 @${c.member.name}`}
                autoFocus
                compact
              />
            </div>
          )}

          {visibleReplies.length > 0 && (
            <div className="mt-3 space-y-3 pl-1 border-l-2 border-[var(--border)] pl-3">
              {visibleReplies.map((r) => (
                <CommentRow
                  key={r.rpid}
                  c={r}
                  oid={oid}
                  type={type}
                  onSeek={onSeek}
                  depth={depth + 1}
                  onReplied={onReplied}
                />
              ))}
              {!showAll && c.replyCount > 3 && (
                <button
                  onClick={() => setShowAll(true)}
                  className="text-xs text-[var(--color-cyan-brand)] hover:underline"
                >
                  共 {c.replyCount} 則回覆
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function CommentSection({
  oid,
  onSeek,
  /** bilibili's comment area type: 1 = video, 11 = image post, 17 = text post. */
  type = 1,
}: {
  oid?: string | number
  onSeek?: (s: number) => void
  type?: number
}) {
  const [mode, setMode] = useState<3 | 2>(3)
  const { toast } = useApp()
  const qc = useQueryClient()

  const query = useInfiniteQuery({
    queryKey: ['comments', String(oid), type, mode],
    enabled: Boolean(oid),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.get('/api/comments', { params: { oid, type, mode, next: pageParam } }),
    getNextPageParam: (last) => (last.cursor?.isEnd ? undefined : last.cursor?.next),
  })

  const all = query.data?.pages.flatMap((p) => p.items as Comment[]) ?? []
  const total = query.data?.pages[0]?.cursor?.allCount

  const post = async (text: string, pictures: Picture[]) => {
    await api.post('/api/comments', { oid, type, message: text, pictures })
    toast('已送出留言', 'ok')
    qc.invalidateQueries({ queryKey: ['comments', String(oid)] })
  }

  return (
    <section className="mt-6">
      <div className="flex items-center gap-4 mb-3">
        <h2 className="font-bold">
          留言 {total !== undefined && <span className="dim font-normal">{count(total)}</span>}
        </h2>
        <div className="flex gap-1 text-xs">
          {([[3, '熱門'], [2, '最新']] as const).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 rounded-full transition-colors ${
                mode === m ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'dim hover:bg-[var(--surface-2)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Composer
        onSubmit={post}
        currentTime={onSeek ? () => (window as any).__biliPlayerTime?.() ?? 0 : undefined}
      />

      <div className="mt-2">
        {query.isLoading && (
          <div className="space-y-4 py-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex gap-3">
                <div className="skeleton w-9 h-9 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-3 w-24 rounded" />
                  <div className="skeleton h-3 w-full rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {all.map((c) => (
          <CommentRow
            key={c.rpid}
            c={c}
            oid={String(oid)}
            type={type}
            onSeek={onSeek}
            onReplied={() => qc.invalidateQueries({ queryKey: ['comments', String(oid)] })}
          />
        ))}

        {query.hasNextPage && (
          <button
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="w-full py-3 text-sm dim hover:text-[var(--accent)] transition-colors"
          >
            {query.isFetchingNextPage ? '載入中…' : '載入更多留言'}
          </button>
        )}

        {!query.isLoading && !all.length && (
          <p className="py-8 text-center text-sm dim">還沒有留言</p>
        )}
      </div>
    </section>
  )
}
