import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useApp } from '@/store/app'
import { VideoGrid } from '@/components/VideoCard'
import * as I from '@/components/Icons'

type Folder = {
  id: number
  mediaId: number
  title: string
  count: number
  cover?: string
  private: boolean
  owner?: string
}

export default function Favourites() {
  const { loggedIn } = useApp()
  const [active, setActive] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')

  const { data: folders, isLoading } = useQuery<{ created: Folder[]; collected: Folder[] }>({
    queryKey: ['favFolders'],
    enabled: loggedIn,
    queryFn: () => api.get('/api/me/favourites'),
  })

  const mediaId = active ?? folders?.created?.[0]?.mediaId ?? null

  const { data: contents, isFetching } = useQuery({
    queryKey: ['favContents', mediaId, page, q],
    enabled: Boolean(mediaId),
    queryFn: () => api.get(`/api/me/favourites/${mediaId}`, { params: { page, q } }),
  })

  if (!loggedIn) {
    return <div className="p-5 text-sm dim">登入後即可同步你的收藏夾</div>
  }

  const all = [...(folders?.created ?? []), ...(folders?.collected ?? [])]

  return (
    <div className="p-3 sm:p-5">
      <h1 className="text-xl font-bold mb-4">收藏夾</h1>

      {isLoading && <div className="skeleton h-10 rounded-lg mb-4" />}

      <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
        {all.map((f) => (
          <button
            key={f.mediaId}
            onClick={() => {
              setActive(f.mediaId)
              setPage(1)
            }}
            className={`shrink-0 px-3.5 h-9 rounded-full text-sm transition-colors flex items-center gap-1.5 ${
              f.mediaId === mediaId
                ? 'bg-[var(--accent)] text-white'
                : 'surface hover:border-[var(--accent)]'
            }`}
          >
            <I.Star className="w-3.5 h-3.5" />
            {f.title}
            <span className="text-xs opacity-70">{f.count}</span>
            {f.private && <span className="text-[10px] opacity-70">私密</span>}
          </button>
        ))}
      </div>

      {mediaId && (
        <>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
            placeholder="在此收藏夾中搜尋"
            className="w-full sm:w-72 h-9 px-3.5 mb-4 rounded-full bg-[var(--surface-2)] outline-none text-sm border border-transparent focus:border-[var(--accent)] transition-colors"
          />

          <VideoGrid items={contents?.items} loading={isFetching && !contents} />

          {/* Tombstones for videos the uploader deleted or made private. */}
          {contents?.items?.some((i: any) => !i.available) && (
            <p className="mt-4 text-xs dim">部分內容已失效(UP 主刪除或設為私密)</p>
          )}

          <div className="flex justify-center gap-2 mt-8">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 h-9 rounded-full surface disabled:opacity-40 text-sm"
            >
              上一頁
            </button>
            <span className="h-9 grid place-items-center px-3 text-sm dim tabular-nums">
              第 {page} 頁
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!contents?.hasMore}
              className="px-4 h-9 rounded-full surface disabled:opacity-40 text-sm"
            >
              下一頁
            </button>
          </div>
        </>
      )}
    </div>
  )
}
