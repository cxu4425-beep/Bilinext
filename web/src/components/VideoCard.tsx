import { Link } from 'react-router-dom'
import { count, duration, timeAgo } from '@/lib/format'

export type Card = {
  bvid: string
  aid?: number
  title: string
  cover?: string
  duration?: number | string
  pubdate?: number
  views?: number
  danmaku?: number
  author?: { mid?: number; name?: string; face?: string }
}

export function VideoCardSkeleton() {
  return (
    <div className="space-y-2">
      <div className="skeleton aspect-video rounded-[var(--radius-card)]" />
      <div className="skeleton h-4 rounded w-full" />
      <div className="skeleton h-3 rounded w-2/3" />
    </div>
  )
}

export default function VideoCard({ v }: { v: Card }) {
  return (
    <Link to={`/video/${v.bvid}`} className="group block">
      <div className="relative aspect-video rounded-[var(--radius-card)] overflow-hidden bg-[var(--surface-2)]">
        {v.cover && (
          <img
            src={v.cover}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        )}
        <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
        {v.duration !== undefined && (
          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 text-white text-[11px] font-medium tabular-nums">
            {duration(v.duration)}
          </span>
        )}
        {v.views !== undefined && (
          <span className="absolute bottom-1.5 left-1.5 text-white text-[11px] font-medium drop-shadow">
            {count(v.views)} 次觀看
          </span>
        )}
      </div>

      <h3 className="mt-2.5 text-[14px] leading-[1.25] font-medium line-clamp-2 group-hover:text-[var(--accent)] transition-colors">
        {v.title}
      </h3>

      <div className="mt-1 flex items-center gap-1.5 text-[11.5px] dim">
        {v.author?.face && (
          <img src={v.author.face} alt="" loading="lazy" className="w-4 h-4 rounded-full object-cover" />
        )}
        <span className="truncate">{v.author?.name}</span>
        {v.pubdate ? <span className="shrink-0">· {timeAgo(v.pubdate)}</span> : null}
      </div>
    </Link>
  )
}

export function VideoGrid({ items, loading }: { items?: Card[]; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-5 gap-y-10">
      {loading && !items?.length
        ? Array.from({ length: 15 }, (_, i) => <VideoCardSkeleton key={i} />)
        : items?.map((v, i) => <VideoCard key={v.bvid || i} v={v} />)}
    </div>
  )
}
