import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/api/client'
import { useApp } from '@/store/app'
import { timeAgo } from '@/lib/format'

type Tab = 'reply' | 'at' | 'like' | 'system' | 'dm'

const TABS: { key: Tab; label: string; badge?: keyof ReturnType<typeof useUnread> }[] = [
  { key: 'reply', label: '回覆我的' },
  { key: 'at', label: '@ 我的' },
  { key: 'like', label: '收到的讚' },
  { key: 'dm', label: '私訊' },
  { key: 'system', label: '系統通知' },
]

const useUnread = () => useApp((s) => s.unread)

/** bilibili's message uris are app links; map the ones we can render. */
function toRoute(uri?: string): string | null {
  if (!uri) return null
  const bv = uri.match(/BV[0-9A-Za-z]{10}/)
  if (bv) return `/video/${bv[0]}`
  const space = uri.match(/space\.bilibili\.com\/(\d+)/)
  if (space) return `/user/${space[1]}`
  return null
}

function Row({
  face,
  name,
  text,
  target,
  time,
  uri,
}: {
  face?: string
  name?: string
  text?: string
  target?: string
  time?: number
  uri?: string
}) {
  const route = toRoute(uri)
  const body = (
    <div className="flex gap-3 p-3 surface rounded-[var(--radius-card)] hover:border-[var(--accent)] transition-colors">
      {face && <img src={face} alt="" loading="lazy" className="w-9 h-9 rounded-full shrink-0 object-cover" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium truncate">{name}</span>
          <span className="text-[11px] dim shrink-0">{timeAgo(time)}</span>
        </div>
        {text && <p className="text-sm mt-0.5 break-words line-clamp-2">{text}</p>}
        {target && <p className="text-[11px] dim mt-1 truncate">於「{target}」</p>}
      </div>
    </div>
  )
  return route ? <Link to={route}>{body}</Link> : body
}

export default function Messages() {
  const [tab, setTab] = useState<Tab>('reply')
  const { loggedIn, unread } = useApp()

  const badges: Record<Tab, number> = {
    reply: unread.reply,
    at: unread.at,
    like: unread.like,
    dm: unread.dm,
    system: unread.systemMsg,
  }

  const { data, isLoading } = useQuery({
    queryKey: ['messages', tab],
    enabled: loggedIn,
    queryFn: () =>
      api.get(
        tab === 'dm'
          ? '/api/me/dm/sessions'
          : tab === 'system'
            ? '/api/me/messages/system'
            : `/api/me/messages/${tab === 'like' ? 'likes' : tab === 'at' ? 'at' : 'replies'}`,
      ),
  })

  if (!loggedIn) return <div className="p-5 text-sm dim">登入後即可同步訊息與提醒</div>

  return (
    <div className="p-3 sm:p-5">
      <h1 className="text-xl font-bold mb-4">訊息中心</h1>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 px-3.5 h-9 rounded-full text-sm transition-colors relative ${
              tab === t.key ? 'bg-[var(--accent)] text-white' : 'surface hover:border-[var(--accent)]'
            }`}
          >
            {t.label}
            {badges[t.key] > 0 && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)] text-white">
                {badges[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton h-16 rounded-[var(--radius-card)]" />
          ))}
        </div>
      )}

      <div className="space-y-2 max-w-2xl">
        {tab === 'like' &&
          (data?.latest ?? []).concat(data?.total ?? []).map((m: any, i: number) => (
            <Row
              key={`${m.id}-${i}`}
              face={m.users?.[0]?.face}
              name={
                m.users?.length > 1
                  ? `${m.users[0]?.name} 等 ${m.users.length} 人`
                  : m.users?.[0]?.name
              }
              text="讚了你的內容"
              target={m.target}
              time={m.time}
              uri={m.uri}
            />
          ))}

        {(tab === 'reply' || tab === 'at') &&
          (data?.items ?? []).map((m: any) => (
            <Row
              key={m.id}
              face={m.user?.face}
              name={m.user?.name}
              text={m.text}
              target={m.target}
              time={m.time}
              uri={m.uri}
            />
          ))}

        {tab === 'system' &&
          (data?.items ?? []).map((m: any) => (
            <Row key={m.id} name={m.title} text={m.text} time={m.time} />
          ))}

        {tab === 'dm' &&
          (data?.items ?? []).map((s: any) => (
            <Link key={s.talkerId} to={`/dm/${s.talkerId}`}>
              <div className="flex items-center gap-3 p-3 surface rounded-[var(--radius-card)] hover:border-[var(--accent)] transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">UID {s.talkerId}</div>
                  <p className="text-sm dim truncate mt-0.5">{s.lastText || '(非文字訊息)'}</p>
                </div>
                {s.unread > 0 && (
                  <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--accent)] text-white text-[11px] grid place-items-center">
                    {s.unread}
                  </span>
                )}
              </div>
            </Link>
          ))}

        {!isLoading &&
          !(data?.items?.length || data?.latest?.length || data?.total?.length) && (
            <p className="py-10 text-center text-sm dim">沒有新訊息</p>
          )}
      </div>
    </div>
  )
}
