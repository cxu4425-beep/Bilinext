import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '@/store/app'
import * as I from './Icons'
import LoginDialog from './LoginDialog'
import Toasts from './Toasts'
import ConnectionBanner from './ConnectionBanner'

const NAV = [
  { to: '/', label: '首頁', icon: I.Home, end: true },
  { to: '/popular', label: '熱門', icon: I.Fire },
  { to: '/following', label: '關注', icon: I.Users },
  { to: '/favourites', label: '收藏', icon: I.Star },
  { to: '/messages', label: '訊息', icon: I.Bell },
]

function Badge({ n }: { n: number }) {
  if (!n) return null
  return (
    <span className="absolute -top-1 -right-1.5 min-w-[17px] h-[17px] px-1 rounded-full bg-[var(--accent)] text-white text-[10px] font-bold grid place-items-center">
      {n > 99 ? '99+' : n}
    </span>
  )
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { account, loggedIn, ready, unread, refreshMe, theme, toggleTheme } = useApp()
  const [loginOpen, setLoginOpen] = useState(false)
  const [q, setQ] = useState('')
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    refreshMe()
  }, [refreshMe])

  // Poll for new notifications, but only while the tab is actually visible --
  // a backgrounded PWA hammering the endpoint is a good way to get rate limited.
  useEffect(() => {
    if (!loggedIn) return
    const tick = () => document.visibilityState === 'visible' && useApp.getState().refreshUnread()
    const id = setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [loggedIn])

  const totalUnread = unread.at + unread.like + unread.reply + unread.dm

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`)
  }

  const isPlayer = location.pathname.startsWith('/video/')

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-40 safe-top backdrop-blur-xl bg-[var(--bg)]/85 border-b border-[var(--border)]">
        <div className="mx-auto max-w-[1600px] px-3 sm:px-5 h-14 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <img src="/icon-192.png" alt="" className="w-8 h-8 rounded-lg" />
            <span className="hidden sm:block font-bold text-[17px] tracking-tight">BiliNext</span>
          </Link>

          <form onSubmit={submitSearch} className="flex-1 max-w-xl mx-auto">
            <div className="relative">
              <I.Search className="w-[18px] h-[18px] absolute left-3 top-1/2 -translate-y-1/2 dim" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜尋影片、UP 主"
                aria-label="搜尋"
                className="w-full h-9 pl-10 pr-3 rounded-full bg-[var(--surface-2)] border border-transparent focus:border-[var(--accent)] outline-none text-sm transition-colors"
              />
            </div>
          </form>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={toggleTheme}
              aria-label="切換主題"
              className="w-9 h-9 grid place-items-center rounded-full hover:bg-[var(--surface-2)] transition-colors"
            >
              {theme === 'dark' ? <I.Sun /> : <I.Moon />}
            </button>
            <Link
              to="/publish"
              className="hidden sm:flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-[var(--accent)] hover:bg-pink-deep text-white text-sm font-medium transition-colors"
            >
              <I.Upload className="w-4 h-4" />
              投稿
            </Link>
            {ready && loggedIn && account ? (
              <Link to="/me" className="ml-1 relative">
                <img
                  src={account.face || '/icon-192.png'}
                  alt={account.name}
                  className="w-9 h-9 rounded-full object-cover ring-2 ring-[var(--accent)]/60"
                />
                <Badge n={totalUnread} />
              </Link>
            ) : (
              <button
                onClick={() => setLoginOpen(true)}
                className="h-9 px-4 rounded-full border border-[var(--border)] hover:border-[var(--accent)] text-sm font-medium transition-colors"
              >
                登入
              </button>
            )}
          </div>
        </div>
      </header>

      <ConnectionBanner />

      <div className="flex-1 mx-auto w-full max-w-[1600px] flex">
        {/* Desktop rail. The player page reclaims the space for the video. */}
        {!isPlayer && (
          <nav className="hidden md:flex flex-col gap-1 w-[188px] shrink-0 p-3 sticky top-14 self-start max-h-[calc(100vh-3.5rem)] overflow-y-auto">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-3 h-10 px-3 rounded-lg text-sm font-medium transition-colors relative ${
                    isActive
                      ? 'bg-[var(--accent)]/12 text-[var(--accent)]'
                      : 'hover:bg-[var(--surface-2)]'
                  }`
                }
              >
                <span className="relative">
                  <Icon />
                  {to === '/messages' && <Badge n={totalUnread} />}
                </span>
                {label}
              </NavLink>
            ))}
            <div className="h-px bg-[var(--border)] my-2" />
            <NavLink
              to="/history"
              className={({ isActive }) =>
                `flex items-center gap-3 h-10 px-3 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-[var(--accent)]/12 text-[var(--accent)]' : 'hover:bg-[var(--surface-2)]'
                }`
              }
            >
              <I.History />
              歷史紀錄
            </NavLink>
            <NavLink
              to="/watchlater"
              className={({ isActive }) =>
                `flex items-center gap-3 h-10 px-3 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-[var(--accent)]/12 text-[var(--accent)]' : 'hover:bg-[var(--surface-2)]'
                }`
              }
            >
              <I.Clock />
              稍後再看
            </NavLink>
            <NavLink
              to="/polls"
              className={({ isActive }) =>
                `flex items-center gap-3 h-10 px-3 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-[var(--accent)]/12 text-[var(--accent)]' : 'hover:bg-[var(--surface-2)]'
                }`
              }
            >
              <I.Poll />
              投票
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `flex items-center gap-3 h-10 px-3 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-[var(--accent)]/12 text-[var(--accent)]' : 'hover:bg-[var(--surface-2)]'
                }`
              }
            >
              <I.Sun />
              設定
            </NavLink>
          </nav>
        )}

        <main className="flex-1 min-w-0 pb-20 md:pb-8">{children}</main>
      </div>

      {/* Mobile tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 safe-bottom bg-[var(--bg)]/95 backdrop-blur-xl border-t border-[var(--border)]">
        <div className="flex">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors ${
                  isActive ? 'text-[var(--accent)]' : 'dim'
                }`
              }
            >
              <span className="relative">
                <Icon className="w-[22px] h-[22px]" />
                {to === '/messages' && <Badge n={totalUnread} />}
              </span>
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
      <Toasts />
    </div>
  )
}
