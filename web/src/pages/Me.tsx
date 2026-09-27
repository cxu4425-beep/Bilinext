import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/api/client'
import { useApp } from '@/store/app'
import { count } from '@/lib/format'
import { VideoGrid } from '@/components/VideoCard'
import * as I from '@/components/Icons'

type Tab = 'videos' | 'followings' | 'dynamics'

/** Your own account: uploads, following list and posts, all pulled from bilibili. */
export default function Me() {
  const { account, loggedIn, coins, logout, toast } = useApp()
  const [tab, setTab] = useState<Tab>('videos')
  const [page, setPage] = useState(1)

  const { data, isFetching } = useQuery({
    queryKey: ['me', tab, page],
    enabled: loggedIn,
    queryFn: () =>
      api.get(
        tab === 'videos'
          ? '/api/me/videos'
          : tab === 'followings'
            ? '/api/me/followings'
            : `/api/dynamics/space/${account?.mid}`,
        { params: { page } },
      ),
  })

  if (!loggedIn || !account) {
    return <div className="p-5 text-sm dim">尚未登入。點右上角「登入」以掃碼登入。</div>
  }

  return (
    <div className="p-3 sm:p-5">
      <div className="flex items-center gap-4 mb-6">
        <img
          src={account.face}
          alt=""
          className="w-16 h-16 rounded-full object-cover ring-2 ring-[var(--accent)]/50"
        />
        <div className="min-w-0">
          <h1 className="text-lg font-bold truncate">{account.name}</h1>
          <p className="text-xs dim mt-0.5">
            UID {account.mid}
            {account.level !== undefined && ` · LV${account.level}`}
            {coins !== undefined && ` · ${coins} 硬幣`}
          </p>
        </div>
        <button
          onClick={() => logout().catch((e) => toast(e.message, 'error'))}
          className="ml-auto h-9 px-4 rounded-full surface hover:border-red-500 hover:text-red-400 text-sm transition-colors"
        >
          登出
        </button>
      </div>

      {/* The phone tab bar has no room for these, and the desktop side rail
          already lists them, so they are only shown below md. */}
      <div className="grid grid-cols-2 gap-2 mb-5 md:hidden">
        {(
          [
            ['/history', '歷史紀錄', I.History],
            ['/watchlater', '稍後再看', I.Clock],
          ] as const
        ).map(([to, label, Icon]) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-2.5 h-12 px-3.5 surface rounded-[var(--radius-card)] text-sm font-medium hover:border-[var(--accent)] transition-colors"
          >
            <Icon className="w-5 h-5 text-[var(--accent)]" />
            {label}
          </Link>
        ))}
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {(
          [
            ['videos', '我的投稿'],
            ['followings', '我的關注'],
            ['dynamics', '我的貼文'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => {
              setTab(k)
              setPage(1)
            }}
            className={`shrink-0 px-3.5 h-9 rounded-full text-sm transition-colors ${
              tab === k ? 'bg-[var(--accent)] text-white' : 'surface hover:border-[var(--accent)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'videos' && <VideoGrid items={data?.items} loading={isFetching && !data} />}

      {tab === 'followings' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data?.items?.map((u: any) => (
            <Link
              key={u.mid}
              to={`/user/${u.mid}`}
              className="flex items-center gap-3 surface rounded-[var(--radius-card)] p-3 hover:border-[var(--accent)] transition-colors"
            >
              <img src={u.face} alt="" loading="lazy" className="w-10 h-10 rounded-full object-cover" />
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {u.name}
                  {u.special && <span className="ml-1.5 text-[10px] text-[var(--accent)]">特別關注</span>}
                </div>
                <p className="text-xs dim truncate">{u.sign || '　'}</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {tab === 'dynamics' && <DynamicList items={data?.items} loading={isFetching && !data} />}

      {(tab === 'videos' || tab === 'followings') && (
        <div className="flex justify-center gap-2 mt-8">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 h-9 rounded-full surface disabled:opacity-40 text-sm"
          >
            上一頁
          </button>
          <span className="h-9 grid place-items-center px-3 text-sm dim">第 {page} 頁</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            className="px-4 h-9 rounded-full surface text-sm"
          >
            下一頁
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Renders bilibili dynamics. Their shape varies a lot by type, so this handles
 * the common ones (text, images, forwarded video) and degrades to plain text
 * rather than rendering an empty card for anything unrecognised.
 */
export function DynamicList({ items, loading }: { items?: any[]; loading?: boolean }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="skeleton h-28 rounded-[var(--radius-card)]" />
        ))}
      </div>
    )
  }
  if (!items?.length) return <p className="py-10 text-center text-sm dim">還沒有貼文</p>

  return (
    <div className="space-y-3 max-w-2xl">
      {items.map((d: any) => {
        const mod = d.modules?.module_dynamic
        const author = d.modules?.module_author
        const text = mod?.desc?.text
        const draw = mod?.major?.draw?.items
        const archive = mod?.major?.archive
        const stat = d.modules?.module_stat

        return (
          <article key={d.id_str} className="surface rounded-[var(--radius-card)] p-4">
            <div className="flex items-center gap-2.5 mb-2">
              {author?.face && (
                <img
                  src={`/api/proxy/image?url=${encodeURIComponent(author.face)}`}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover"
                />
              )}
              <div>
                <div className="text-sm font-medium">{author?.name}</div>
                <div className="text-[11px] dim">{author?.pub_time}</div>
              </div>
            </div>

            {text && <p className="text-sm whitespace-pre-wrap break-words">{text}</p>}

            {draw?.length > 0 && (
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {draw.slice(0, 9).map((p: any, i: number) => (
                  <img
                    key={i}
                    src={`/api/proxy/image?url=${encodeURIComponent(p.src)}`}
                    alt=""
                    loading="lazy"
                    className="aspect-square object-cover rounded-lg"
                  />
                ))}
              </div>
            )}

            {archive && (
              <Link
                to={`/video/${archive.bvid}`}
                className="mt-2 flex gap-3 rounded-lg overflow-hidden bg-[var(--surface-2)] hover:opacity-90 transition-opacity"
              >
                <img
                  src={`/api/proxy/image?url=${encodeURIComponent(archive.cover)}`}
                  alt=""
                  loading="lazy"
                  className="w-32 aspect-video object-cover shrink-0"
                />
                <div className="py-2 pr-2 min-w-0">
                  <div className="text-sm font-medium line-clamp-2">{archive.title}</div>
                  <div className="text-[11px] dim mt-1">{archive.stat?.play} 播放</div>
                </div>
              </Link>
            )}

            {stat && (
              <div className="flex gap-4 mt-3 text-[11px] dim">
                <span>轉發 {count(stat.forward?.count)}</span>
                <span>留言 {count(stat.comment?.count)}</span>
                <span>讚 {count(stat.like?.count)}</span>
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}

/** Another user's space. */
export function UserPage() {
  const { mid = '' } = useParams()
  const [page, setPage] = useState(1)
  const { toast } = useApp()

  const { data: user } = useQuery({
    queryKey: ['user', mid],
    queryFn: () => api.get(`/api/user/${mid}`),
  })
  const { data: videos, isFetching } = useQuery({
    queryKey: ['userVideos', mid, page],
    queryFn: () => api.get(`/api/user/${mid}/videos`, { params: { page } }),
  })

  return (
    <div className="p-3 sm:p-5">
      <div className="flex items-center gap-4 mb-6">
        <img src={user?.face} alt="" className="w-16 h-16 rounded-full object-cover bg-[var(--surface-2)]" />
        <div className="min-w-0">
          <h1 className="text-lg font-bold truncate">{user?.name ?? '　'}</h1>
          <p className="text-xs dim mt-0.5 line-clamp-2">{user?.sign}</p>
          <p className="text-xs dim mt-1">
            {count(user?.fans)} 粉絲 · {count(user?.archives)} 投稿
          </p>
        </div>
        <button
          onClick={async () => {
            try {
              await api.post(`/api/user/${mid}/follow`, { on: true })
              toast('已關注', 'ok')
            } catch (e: any) {
              toast(e.message || '操作失敗', 'error')
            }
          }}
          className="ml-auto h-9 px-4 rounded-full bg-[var(--accent)] text-white text-sm font-medium"
        >
          + 關注
        </button>
      </div>

      <VideoGrid items={videos?.items} loading={isFetching && !videos} />

      <div className="flex justify-center gap-2 mt-8">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="px-4 h-9 rounded-full surface disabled:opacity-40 text-sm"
        >
          上一頁
        </button>
        <span className="h-9 grid place-items-center px-3 text-sm dim">第 {page} 頁</span>
        <button onClick={() => setPage((p) => p + 1)} className="px-4 h-9 rounded-full surface text-sm">
          下一頁
        </button>
      </div>
    </div>
  )
}
