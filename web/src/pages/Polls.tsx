import { useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useApp } from '@/store/app'
import PollCard from '@/components/PollCard'
import { DynamicList } from './Me'

/**
 * Polls on bilibili live inside dynamics, so this page scans the dynamic feed
 * for attached vote cards and surfaces them as a single votable list, then
 * falls back to a lookup box for a poll you have a link or id for.
 */
export default function Polls() {
  const { loggedIn } = useApp()
  const [lookup, setLookup] = useState('')
  const [manualId, setManualId] = useState<string | null>(null)

  /**
   * Polls are sparse in a dynamic feed -- a real account can easily go several
   * pages without one -- so this walks the feed rather than reading a single
   * page and concluding there are none.
   */
  const query = useInfiniteQuery({
    queryKey: ['dynamics', 'polls'],
    enabled: loggedIn,
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      api.get('/api/dynamics', { params: { type: 'all', offset: pageParam } }),
    getNextPageParam: (last) => (last.hasMore ? last.offset : undefined),
    maxPages: 8,
  })

  const withPolls =
    query.data?.pages
      .flatMap((p: any) => p.items ?? [])
      .filter(
        (d: any) =>
          d.modules?.module_dynamic?.additional?.type === 'ADDITIONAL_TYPE_VOTE' &&
          d.modules?.module_dynamic?.additional?.vote?.vote_id,
      ) ?? []

  const scanned = query.data?.pages.reduce((n: number, p: any) => n + (p.items?.length ?? 0), 0) ?? 0

  const submitLookup = (e: React.FormEvent) => {
    e.preventDefault()
    // A pasted share link looks like //www.bilibili.com/h5/vote?vote_id=123&dyn_id=456,
    // where the dyn_id would win a naive "first long number" match.
    const id = lookup.match(/vote_id=(\d+)/)?.[1] ?? lookup.match(/\d{4,}/)?.[0]
    if (id) setManualId(id)
  }

  return (
    <div className="p-3 sm:p-5 max-w-2xl">
      <h1 className="text-xl font-bold mb-4">投票</h1>

      <form onSubmit={submitLookup} className="flex gap-2 mb-6">
        <input
          value={lookup}
          onChange={(e) => setLookup(e.target.value)}
          placeholder="輸入投票 ID 或貼上連結"
          className="input flex-1"
        />
        <button className="px-4 h-9 rounded-lg bg-[var(--accent)] text-white text-sm font-medium shrink-0">
          查詢
        </button>
      </form>

      {manualId && (
        <div className="mb-6">
          <PollCard voteId={manualId} />
        </div>
      )}

      {!loggedIn && <p className="text-sm dim">登入後可看關注動態中的投票。</p>}

      {loggedIn && (
        <>
          <div className="flex items-baseline gap-3 mb-3">
            <h2 className="font-bold text-sm">關注動態中的投票</h2>
            {scanned > 0 && (
              <span className="text-[11px] dim">
                已掃描 {scanned} 則動態,找到 {withPolls.length} 個
              </span>
            )}
          </div>

          {query.isLoading && <div className="skeleton h-44 rounded-[var(--radius-card)]" />}

          <div className="space-y-5">
            {withPolls.map((d: any) => (
              <article key={d.id_str} className="space-y-2">
                {d.modules?.module_dynamic?.desc?.text && (
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {d.modules.module_dynamic.desc.text}
                  </p>
                )}
                <PollCard voteId={d.modules.module_dynamic.additional.vote.vote_id} />
              </article>
            ))}
          </div>

          {!query.isLoading && !withPolls.length && (
            <p className="text-sm dim">
              掃描到的動態裡沒有投票。你可以到「建立內容 → 發起投票」自己開一個。
            </p>
          )}

          {query.hasNextPage && (
            <button
              onClick={() => query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              className="mt-5 w-full h-10 rounded-full surface hover:border-[var(--accent)] text-sm transition-colors"
            >
              {query.isFetchingNextPage ? '掃描中…' : '再往前找更多動態'}
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** Standalone dynamics feed, reachable from the router. */
export function Dynamics() {
  const { loggedIn } = useApp()
  const { data, isLoading } = useQuery({
    queryKey: ['dynamics', 'all'],
    enabled: loggedIn,
    queryFn: () => api.get('/api/dynamics'),
  })
  if (!loggedIn) return <div className="p-5 text-sm dim">登入後可看動態</div>
  return (
    <div className="p-3 sm:p-5">
      <h1 className="text-xl font-bold mb-4">動態</h1>
      <DynamicList items={data?.items} loading={isLoading} />
    </div>
  )
}
