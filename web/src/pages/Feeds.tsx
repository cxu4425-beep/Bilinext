import { useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '@/api/client'
import VideoCard, { VideoGrid } from '@/components/VideoCard'
import { useApp } from '@/store/app'
import { count, duration, timeAgo } from '@/lib/format'
import * as I from '@/components/Icons'
import QueryState from '@/components/QueryState'
import FollowingRail from '@/components/FollowingRail'
import LiveRail from '@/components/LiveRail'
import DynamicCard, { DynamicCardSkeleton, type Dynamic } from '@/components/DynamicCard'

/** Keeps the first occurrence of each bvid, preserving feed order. */
function dedupe<T extends { bvid: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((v) => (v.bvid && !seen.has(v.bvid) ? (seen.add(v.bvid), true) : false))
}

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-3 sm:p-5">
      <h1 className="text-xl font-bold mb-4">{title}</h1>
      {children}
    </div>
  )
}

/** Home: the personalised feed when signed in, 熱門 otherwise. */
export function Home() {
  const query = useInfiniteQuery({
    queryKey: ['feed', 'recommended'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.get('/api/feed/recommended', { params: { page: pageParam } }),
    getNextPageParam: (_l, all) => all.length + 1,
  })
  // The server de-duplicates within a page; bilibili can still repeat a video
  // across pages, and a duplicate key would make React reuse the wrong card.
  const items = dedupe(query.data?.pages.flatMap((p) => p.items) ?? [])
  const personalised = query.data?.pages[0]?.personalised

  return (
    <div className="p-3 sm:p-5">
      <div className="flex items-baseline gap-3 mb-4">
        <h1 className="text-xl font-bold">{personalised ? '為你推薦' : '熱門推薦'}</h1>
        {personalised === false && (
          <span className="text-xs dim">登入後可看個人化推薦</span>
        )}
      </div>
      <VideoGrid items={items} loading={query.isLoading} />
      <QueryState
        error={query.error}
        isLoading={query.isLoading}
        isEmpty={!items.length}
        onRetry={() => query.refetch()}
      />
      <LoadMore query={query} />
    </div>
  )
}

export function Popular() {
  const query = useInfiniteQuery({
    queryKey: ['feed', 'popular'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.get('/api/feed/popular', { params: { page: pageParam } }),
    getNextPageParam: (last, all) => (last.noMore ? undefined : all.length + 1),
  })
  return (
    <Page title="熱門">
      <VideoGrid items={dedupe(query.data?.pages.flatMap((p) => p.items) ?? [])} loading={query.isLoading} />
      <QueryState
        error={query.error}
        isLoading={query.isLoading}
        isEmpty={!query.data?.pages[0]?.items?.length}
        onRetry={() => query.refetch()}
      />
      <LoadMore query={query} />
    </Page>
  )
}

/**
 * The "following" feed comes back as bilibili's dynamic objects rather than
 * plain video cards, so it is flattened here into the same shape the grid uses.
 */
export function Following() {
  const { loggedIn } = useApp()
  const [selectedUp, setSelectedUp] = useState<string | null>(null)

  const query = useInfiniteQuery({
    queryKey: selectedUp === null ? ['feed', 'following'] : ['dynamics', 'space', selectedUp],
    enabled: loggedIn,
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      selectedUp === null
        ? api.get('/api/feed/following', { params: { offset: pageParam } })
        : api.get(`/api/dynamics/space/${selectedUp}`, { params: { offset: pageParam } }),
    getNextPageParam: (last) => (last.hasMore ? last.offset : undefined),
  })

  if (!loggedIn) return <Page title="關注">{<p className="dim text-sm">登入後可看關注動態</p>}</Page>

  const items: Dynamic[] = query.data?.pages.flatMap((p: any) => p.items ?? []) ?? []

  return (
    <div className="p-3 sm:p-5 flex flex-col lg:flex-row gap-5">
      <FollowingRail selected={selectedUp} onSelect={setSelectedUp} />

      {/* The feed column is capped so cards stay a comfortable reading width. */}
      <div className="flex-1 min-w-0 max-w-[600px]">
        <div className="flex items-center gap-3 mb-4">
          <h1 className="text-xl font-bold">
            {selectedUp === null ? '全部動態' : items[0]?.author?.name || '動態'}
          </h1>
          {selectedUp !== null && (
            <Link
              to={`/user/${selectedUp}`}
              className="ml-auto text-xs dim hover:text-[var(--accent)] transition-colors"
            >
              查看個人空間 →
            </Link>
          )}
        </div>

        <div className="space-y-3">
          {query.isLoading
            ? Array.from({ length: 3 }, (_, i) => <DynamicCardSkeleton key={i} />)
            : items.map((d) => <DynamicCard key={d.id} d={d} />)}
        </div>

        <QueryState
          error={query.error}
          isLoading={query.isLoading}
          isEmpty={!items.length}
          onRetry={() => query.refetch()}
          emptyText={selectedUp === null ? '關注的 UP 主最近沒有動態' : '這位 UP 主沒有動態'}
        />
        <LoadMore query={query} />
      </div>

      <LiveRail />
    </div>
  )
}

export function Search() {
  const [params] = useSearchParams()
  const q = params.get('q') || ''
  const query = useInfiniteQuery({
    queryKey: ['search', q],
    enabled: Boolean(q),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.get('/api/search', { params: { q, page: pageParam } }),
    getNextPageParam: (last, all) => (all.length < (last.pages ?? 1) ? all.length + 1 : undefined),
  })
  return (
    <Page title={`搜尋:${q}`}>
      <VideoGrid items={query.data?.pages.flatMap((p) => p.items)} loading={query.isLoading} />
      <QueryState
        error={query.error}
        isLoading={query.isLoading}
        isEmpty={!query.data?.pages[0]?.items?.length}
        onRetry={() => query.refetch()}
        emptyText="沒有找到相符的影片"
      />
      <LoadMore query={query} />
    </Page>
  )
}

export function History() {
  const { loggedIn } = useApp()
  const { data, isLoading } = useQuery({
    queryKey: ['history'],
    enabled: loggedIn,
    queryFn: () => api.get('/api/me/history'),
  })
  if (!loggedIn) return <Page title="歷史紀錄">{<p className="dim text-sm">請先登入</p>}</Page>

  return (
    <Page title="歷史紀錄">
      {isLoading && <div className="skeleton h-40 rounded-[var(--radius-card)]" />}
      <div className="space-y-2">
        {data?.items?.map((h: any, i: number) => (
          <Link
            key={`${h.bvid}-${i}`}
            to={`/video/${h.bvid}`}
            className="flex gap-3 surface rounded-[var(--radius-card)] p-2 hover:border-[var(--accent)] transition-colors"
          >
            <div className="relative w-40 shrink-0 aspect-video rounded-lg overflow-hidden bg-[var(--surface-2)]">
              <img src={h.cover} alt="" loading="lazy" className="w-full h-full object-cover" />
              {/* How far through the video you got, as bilibili records it. */}
              {h.duration > 0 && h.progress > 0 && (
                <span
                  className="absolute bottom-0 left-0 h-1 bg-[var(--accent)]"
                  style={{ width: `${Math.min(100, (h.progress / h.duration) * 100)}%` }}
                />
              )}
            </div>
            <div className="min-w-0 py-1">
              <h3 className="text-sm font-medium line-clamp-2">{h.title}</h3>
              <p className="text-xs dim mt-1">{h.author?.name}</p>
              <p className="text-xs dim">{timeAgo(h.viewAt)}</p>
            </div>
          </Link>
        ))}
      </div>
    </Page>
  )
}

type WatchLaterItem = {
  aid: number
  bvid: string
  title: string
  cover?: string
  duration?: number
  author?: { name?: string }
  /** Seconds watched; -1 is bilibili's "finished". */
  progress: number
  addedAt: number
  available: boolean
}

export function WatchLater() {
  const { loggedIn, toast } = useApp()
  const qc = useQueryClient()
  // The list is read back a few seconds behind a delete, so a refetch would
  // bring a just-removed video back. Removals are hidden locally instead.
  const [removed, setRemoved] = useState<Set<number>>(() => new Set())
  const query = useQuery<{ items: WatchLaterItem[]; count: number }>({
    queryKey: ['watchlater'],
    enabled: loggedIn,
    queryFn: () => api.get('/api/me/watchlater'),
  })

  if (!loggedIn) return <Page title="稍後再看">{<p className="dim text-sm">請先登入</p>}</Page>

  const items = (query.data?.items ?? []).filter((w) => !removed.has(w.aid))

  const remove = async (aid: number) => {
    setRemoved((s) => new Set(s).add(aid))
    try {
      await api.post('/api/me/watchlater/remove', { aid })
      // The video page shows membership too; let it re-read next time it opens.
      qc.invalidateQueries({ queryKey: ['video'], refetchType: 'none' })
    } catch (err: any) {
      setRemoved((s) => {
        const next = new Set(s)
        next.delete(aid)
        return next
      })
      toast(err.message || '移除失敗', 'error')
    }
  }

  return (
    <Page title={query.data ? `稍後再看 · ${items.length}` : '稍後再看'}>
      <QueryState
        error={query.error}
        isLoading={query.isLoading}
        isEmpty={query.isSuccess && !items.length}
        onRetry={() => query.refetch()}
        emptyText="稍後再看是空的。在影片頁按「稍後再看」就會出現在這裡。"
      />
      <div className="space-y-2">
        {items.map((w) => {
          const finished = w.progress === -1
          const watched = finished ? 1 : w.duration ? Math.min(1, Math.max(0, w.progress) / w.duration) : 0
          const status = !w.available
            ? '影片已失效'
            : finished
              ? '已看完'
              : w.progress > 0
                ? `看到 ${duration(w.progress)}`
                : `${timeAgo(w.addedAt)}加入`
          return (
            <div
              key={w.aid}
              className="flex items-center gap-2 surface rounded-[var(--radius-card)] p-2 hover:border-[var(--accent)] transition-colors"
            >
              <Link
                to={`/video/${w.bvid}`}
                className={`flex gap-3 flex-1 min-w-0 ${w.available ? '' : 'opacity-50'}`}
              >
                <div className="relative w-40 shrink-0 aspect-video rounded-lg overflow-hidden bg-[var(--surface-2)]">
                  {w.cover && <img src={w.cover} alt="" loading="lazy" className="w-full h-full object-cover" />}
                  {w.duration ? (
                    <span className="absolute bottom-1.5 right-1 px-1 rounded bg-black/70 text-white text-[10px] tabular-nums">
                      {duration(w.duration)}
                    </span>
                  ) : null}
                  {watched > 0 && (
                    <span
                      className="absolute bottom-0 left-0 h-1 bg-[var(--accent)]"
                      style={{ width: `${watched * 100}%` }}
                    />
                  )}
                </div>
                <div className="min-w-0 py-1">
                  <h3 className="text-sm font-medium line-clamp-2">{w.title}</h3>
                  <p className="text-xs dim mt-1 truncate">{w.author?.name}</p>
                  <p className="text-xs dim">{status}</p>
                </div>
              </Link>
              <button
                onClick={() => remove(w.aid)}
                aria-label="從稍後再看移除"
                title="移除"
                className="shrink-0 w-10 h-10 grid place-items-center rounded-lg dim hover:text-red-400 hover:bg-[var(--surface-2)] transition-colors"
              >
                <I.Close className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>
    </Page>
  )
}

export function LoadMore({ query }: { query: any }) {
  if (!query.hasNextPage) return null
  return (
    <button
      onClick={() => query.fetchNextPage()}
      disabled={query.isFetchingNextPage}
      className="mt-8 mx-auto block px-6 h-10 rounded-full surface hover:border-[var(--accent)] text-sm transition-colors"
    >
      {query.isFetchingNextPage ? '載入中…' : '載入更多'}
    </button>
  )
}
