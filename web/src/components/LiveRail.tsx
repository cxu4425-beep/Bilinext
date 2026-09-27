import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'

type LiveUser = {
  mid: string
  name: string
  face: string
  roomId: string
  title: string
  url: string
}

/**
 * The "关注直播" panel bilibili shows beside the dynamics feed. It is hidden
 * entirely when nobody is streaming rather than left as an empty box.
 */
export default function LiveRail() {
  const { data } = useQuery<{ liveUsers: LiveUser[]; liveCount: number }>({
    queryKey: ['dynamicsPortal'],
    queryFn: () => api.get('/api/dynamics/portal'),
    staleTime: 2 * 60 * 1000,
  })

  const users = data?.liveUsers ?? []
  if (!users.length) return null

  return (
    <aside className="hidden xl:block w-[300px] shrink-0">
      <div className="sticky top-[4.5rem] surface rounded-[var(--radius-card)] p-3">
        <div className="flex items-baseline gap-1.5 mb-2 px-1">
          <h2 className="font-bold text-[15px]">關注直播</h2>
          <span className="text-xs dim">· {data?.liveCount ?? users.length}</span>
          <a
            href="https://live.bilibili.com"
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs dim hover:text-[var(--accent)] transition-colors"
          >
            更多 ›
          </a>
        </div>

        <div className="space-y-0.5">
          {users.map((u) => (
            <a
              key={u.mid}
              href={u.url || `https://live.bilibili.com/${u.roomId}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-[var(--surface-2)] transition-colors"
            >
              <span className="relative shrink-0">
                <img src={u.face} alt="" loading="lazy" className="w-10 h-10 rounded-full object-cover" />
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-1 rounded-sm bg-[var(--color-bili-dark)] text-white text-[8px] leading-[12px] font-medium whitespace-nowrap">
                  <svg viewBox="0 0 24 24" className="w-2 h-2" fill="currentColor">
                    <rect x="3" y="10" width="3" height="10" rx="1" />
                    <rect x="10" y="5" width="3" height="15" rx="1" />
                    <rect x="17" y="13" width="3" height="7" rx="1" />
                  </svg>
                  直播中
                </span>
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium truncate">{u.name}</span>
                <span className="block text-[11px] dim truncate">{u.title}</span>
              </span>
            </a>
          ))}
        </div>
      </div>
    </aside>
  )
}
