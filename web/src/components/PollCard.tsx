import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useApp } from '@/store/app'
import { count } from '@/lib/format'

export type Poll = {
  id: number
  title: string
  desc?: string
  startTime?: number
  endTime?: number
  joined: number
  choiceCount: number
  creator?: { mid: number; name: string; face: string }
  image?: string | null
  myVotes: number[]
  closed: boolean
  options: { index: number; text: string; count: number }[]
}

/** "剩餘 6 天" / "剩餘 3 小時" / "已結束", the way bilibili labels a poll. */
function remaining(endTime?: number): string {
  if (!endTime) return ''
  const secs = endTime - Date.now() / 1000
  if (secs <= 0) return '已結束'
  const days = Math.floor(secs / 86400)
  if (days >= 1) return `剩餘 ${days} 天`
  const hours = Math.floor(secs / 3600)
  if (hours >= 1) return `剩餘 ${hours} 小時`
  return `剩餘 ${Math.max(1, Math.floor(secs / 60))} 分鐘`
}

/**
 * vote_svr does not always echo the caller's choice back, so a vote made in
 * this session is also remembered locally. Without it the card would snap back
 * to the unvoted state on the next refetch and invite a second vote on a poll
 * that cannot be changed.
 */
const localKey = (id: number | string) => `bili.voted.${id}`
function readLocalVote(id: number | string): number[] {
  try {
    const raw = localStorage.getItem(localKey(id))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

const PollIcon = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
    <path d="M6 20V11M12 20V4M18 20v-6" />
  </svg>
)

const Tick = ({ className = 'w-3 h-3' }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 12.5 5 5L19 7" />
  </svg>
)

export default function PollCard({ voteId }: { voteId: number | string }) {
  const [staged, setStaged] = useState<number[]>([])
  const [localVotes, setLocalVotes] = useState<number[]>(() => readLocalVote(voteId))
  const { loggedIn, toast } = useApp()
  const qc = useQueryClient()

  useEffect(() => setLocalVotes(readLocalVote(voteId)), [voteId])

  const { data: poll, isLoading, error } = useQuery<Poll>({
    queryKey: ['vote', String(voteId)],
    queryFn: () => api.get(`/api/vote/${voteId}`),
  })

  const vote = useMutation({
    mutationFn: (options: number[]) => api.post(`/api/vote/${voteId}`, { options }),
    onSuccess: (_d, options) => {
      try {
        localStorage.setItem(localKey(voteId), JSON.stringify(options))
      } catch {
        /* private mode; the server value still drives the next load */
      }
      setLocalVotes(options)
      setStaged([])
      toast('投票成功', 'ok')
      qc.invalidateQueries({ queryKey: ['vote', String(voteId)] })
    },
    onError: (e: any) => toast(e.message || '投票失敗', 'error'),
  })

  if (isLoading) {
    return <div className="skeleton h-44 rounded-[var(--radius-card)]" />
  }
  if (error || !poll) {
    return (
      <div className="surface rounded-[var(--radius-card)] p-4 text-sm dim">
        無法載入投票{error ? `:${(error as Error).message}` : ''}
      </div>
    )
  }

  const myVotes = poll.myVotes.length ? poll.myVotes : localVotes
  const voted = myVotes.length > 0
  const totalVotes = poll.options.reduce((s, o) => s + o.count, 0)
  const multi = poll.choiceCount > 1
  // Bilibili keeps the tallies hidden until you have taken part, or it is over.
  const revealed = voted || poll.closed

  const toggle = (idx: number) => {
    if (revealed || vote.isPending) return
    if (!loggedIn) return toast('請先登入才能投票', 'error')
    setStaged((s) =>
      s.includes(idx)
        ? s.filter((i) => i !== idx)
        : multi
          ? s.length >= poll.choiceCount
            ? s
            : [...s, idx]
          : [idx],
    )
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
      {/* Creator strip, as the native card shows */}
      {poll.creator?.name && (
        <div className="flex items-center gap-2 mb-2">
          {poll.creator.face && (
            <img src={poll.creator.face} alt="" loading="lazy" className="w-5 h-5 rounded-full object-cover" />
          )}
          <span className="text-[11px] dim truncate">{poll.creator.name} 發起的投票</span>
        </div>
      )}

      <div className="flex items-start gap-2 mb-1">
        <span className="mt-0.5 shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-white bg-[var(--color-bili-dark)]">
          <PollIcon className="w-2.5 h-2.5" />
          投票
        </span>
        <h3 className="font-semibold text-[15px] leading-snug min-w-0">{poll.title}</h3>
      </div>

      {poll.desc && <p className="text-xs dim mb-2 ml-0.5">{poll.desc}</p>}

      {poll.image && (
        <img src={poll.image} alt="" className="w-full rounded-lg mb-2.5 object-cover max-h-52" />
      )}

      {multi && !revealed && (
        <p className="text-[11px] dim mb-2">最多可選 {poll.choiceCount} 項</p>
      )}

      <div className="space-y-2 mt-2.5">
        {poll.options.map((o) => {
          const pct = totalVotes ? Math.round((o.count / totalVotes) * 100) : 0
          const mine = myVotes.includes(o.index)
          const isStaged = staged.includes(o.index)

          // Revealed: a filled tally bar. Unrevealed: a plain selectable pill.
          if (revealed) {
            return (
              <div
                key={o.index}
                className={`relative overflow-hidden rounded-lg border ${
                  mine ? 'border-[var(--color-bili-dark)]' : 'border-transparent'
                } bg-[var(--surface)]`}
              >
                <span
                  className="absolute inset-y-0 left-0 bg-[var(--color-bili-dark)]/18 transition-[width] duration-700 ease-out"
                  style={{ width: `${pct}%` }}
                />
                <span className="relative flex items-center gap-2 px-3 py-2.5 text-sm">
                  {mine && (
                    <span className="shrink-0 w-4 h-4 rounded-full bg-[var(--color-bili-dark)] text-white grid place-items-center">
                      <Tick className="w-2.5 h-2.5" />
                    </span>
                  )}
                  <span className={`flex-1 min-w-0 ${mine ? 'text-[var(--color-bili-dark)] font-medium' : ''}`}>
                    {o.text}
                  </span>
                  <span className="shrink-0 tabular-nums text-xs dim">
                    {count(o.count)}票
                  </span>
                  <span className="shrink-0 tabular-nums text-xs font-medium w-9 text-right">
                    {pct}%
                  </span>
                </span>
              </div>
            )
          }

          return (
            <button
              key={o.index}
              onClick={() => toggle(o.index)}
              disabled={vote.isPending}
              aria-pressed={isStaged}
              className={`w-full rounded-lg border px-3 py-2.5 text-sm transition-colors flex items-center gap-2 ${
                isStaged
                  ? 'border-[var(--color-bili-dark)] bg-[var(--color-bili-dark)]/10 text-[var(--color-bili-dark)] font-medium'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--color-bili-dark)]'
              }`}
            >
              <span
                className={`shrink-0 w-4 h-4 grid place-items-center border transition-colors ${
                  multi ? 'rounded-[4px]' : 'rounded-full'
                } ${
                  isStaged
                    ? 'bg-[var(--color-bili-dark)] border-[var(--color-bili-dark)] text-white'
                    : 'border-[var(--text-dim)]'
                }`}
              >
                {isStaged && <Tick className="w-2.5 h-2.5" />}
              </span>
              <span className="flex-1 min-w-0 text-left">{o.text}</span>
            </button>
          )
        })}
      </div>

      {!revealed && (
        <button
          onClick={() => vote.mutate(staged)}
          disabled={!staged.length || vote.isPending}
          className="mt-3 w-full h-9 rounded-lg bg-[var(--color-bili-dark)] hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 text-white text-sm font-medium transition-all"
        >
          {vote.isPending ? '投票中…' : '投票'}
        </button>
      )}

      <div className="flex items-center gap-2 mt-2.5 text-[11px] dim">
        <span>{count(poll.joined)} 人參與</span>
        {poll.endTime ? (
          <>
            <span>·</span>
            <span>{remaining(poll.endTime)}</span>
          </>
        ) : null}
        {voted && !poll.closed && (
          <>
            <span>·</span>
            <span className="text-[var(--color-bili-dark)]">已投票</span>
          </>
        )}
      </div>
    </div>
  )
}
