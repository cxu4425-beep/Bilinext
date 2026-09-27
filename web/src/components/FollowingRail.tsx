import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'

export type PortalUp = {
  mid: string
  name: string
  face: string
  hasUpdate: boolean
  live: { roomId: string; title: string } | null
}

/**
 * The UP list beside the dynamics feed, mirroring bilibili's own: "all", then
 * everyone you follow ordered by who posted most recently, with a dot marking
 * unseen activity. The ordering and the dots come straight from bilibili's
 * portal endpoint rather than being derived here, so the list matches what the
 * official site shows.
 */
export default function FollowingRail({
  selected,
  onSelect,
}: {
  selected: string | null
  onSelect: (mid: string | null) => void
}) {
  const { data, isLoading } = useQuery<{ ups: PortalUp[]; liveCount: number }>({
    queryKey: ['dynamicsPortal'],
    queryFn: () => api.get('/api/dynamics/portal'),
    staleTime: 2 * 60 * 1000,
  })

  const ups = data?.ups ?? []

  const Row = ({ up }: { up: PortalUp }) => {
    const active = selected === up.mid
    return (
      <button
        onClick={() => onSelect(up.mid)}
        title={up.live ? `直播中:${up.live.title}` : up.name}
        className={`w-full h-[52px] flex items-center gap-2.5 pl-2 pr-5 rounded-[var(--radius-chip)] text-left transition-colors ${
          active ? 'bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]/60'
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            up.hasUpdate ? 'bg-[var(--accent)]' : 'bg-transparent'
          }`}
          aria-hidden="true"
        />
        <span className="relative shrink-0">
          <img
            src={up.face}
            alt=""
            loading="lazy"
            className={`w-9 h-9 rounded-full object-cover ${
              up.live ? 'ring-2 ring-[var(--color-bili-dark)]' : ''
            }`}
          />
          {up.live && (
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1 rounded-sm bg-[var(--color-bili-dark)] text-white text-[8px] leading-[11px] font-medium">
              LIVE
            </span>
          )}
        </span>
        <span className={`text-[13px] truncate ${active ? '' : 'dim'}`}>{up.name}</span>
      </button>
    )
  }

  const allButton = (
    <button
      onClick={() => onSelect(null)}
      className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-[var(--radius-card)] text-left transition-colors ${
        selected === null ? 'bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]/60'
      }`}
    >
      <span className="w-9 h-9 rounded-full shrink-0 grid place-items-center bg-gradient-to-br from-[var(--accent)] to-[var(--color-pink-deep)]">
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round">
          <path d="M12 12c0-4 2-7 5-7s3 4 0 5-9 0-9 4 3 5 5 3 1-9-3-9-5 3-5 6" />
        </svg>
      </span>
      <span className="text-sm font-medium">全部動態</span>
    </button>
  )

  return (
    <>
      {/* Desktop: a sticky vertical rail, as on bilibili. */}
      <aside className="hidden lg:block w-[260px] shrink-0">
        <div className="sticky top-[4.5rem] max-h-[calc(100vh-6rem)] overflow-y-auto pr-1 space-y-0.5">
          {allButton}
          <div className="h-px bg-[var(--border)] my-2" />
          {isLoading
            ? Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 pl-1">
                  <span className="w-1.5" />
                  <div className="skeleton w-9 h-9 rounded-full" />
                  <div className="skeleton h-3 flex-1 rounded" />
                </div>
              ))
            : ups.map((up) => <Row key={up.mid} up={up} />)}
        </div>
      </aside>

      {/* Mobile: the same list as a horizontal strip of avatars. */}
      <div className="lg:hidden -mx-3 px-3 mb-4">
        <div className="flex gap-3 overflow-x-auto pb-2">
          <button
            onClick={() => onSelect(null)}
            className="shrink-0 w-14 flex flex-col items-center gap-1"
          >
            <span
              className={`w-12 h-12 rounded-full grid place-items-center bg-gradient-to-br from-[var(--accent)] to-[var(--color-pink-deep)] ${
                selected === null ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]' : ''
              }`}
            >
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round">
                <path d="M12 12c0-4 2-7 5-7s3 4 0 5-9 0-9 4 3 5 5 3 1-9-3-9-5 3-5 6" />
              </svg>
            </span>
            <span className="text-[10px] truncate w-full text-center">全部</span>
          </button>
          {ups.map((up) => (
            <button
              key={up.mid}
              onClick={() => onSelect(up.mid)}
              className="shrink-0 w-14 flex flex-col items-center gap-1"
            >
              <span className="relative">
                <img
                  src={up.face}
                  alt=""
                  loading="lazy"
                  className={`w-12 h-12 rounded-full object-cover ${
                    selected === up.mid
                      ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]'
                      : up.live
                        ? 'ring-2 ring-[var(--color-bili-dark)]'
                        : ''
                  }`}
                />
                {up.hasUpdate && (
                  <span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-[var(--accent)] border-2 border-[var(--bg)]" />
                )}
              </span>
              <span className="text-[10px] truncate w-full text-center dim">{up.name}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
