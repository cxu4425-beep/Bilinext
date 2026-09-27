import { create } from 'zustand'
import { ApiError, api, onConnectivity, ping } from '@/api/client'

export type Account = {
  mid: string
  name?: string
  face?: string
  level?: number
}

type Toast = { id: number; text: string; tone: 'ok' | 'error' | 'info' }

type State = {
  account: Account | null
  loggedIn: boolean
  ready: boolean
  /** False when the local server is unreachable -- distinct from being logged out. */
  serverOnline: boolean
  coins?: number
  unread: { at: number; like: number; reply: number; systemMsg: number; dm: number }
  toasts: Toast[]
  theme: 'dark' | 'light'

  refreshMe: () => Promise<void>
  retryConnection: () => Promise<boolean>
  setServerOnline: (online: boolean) => void
  refreshUnread: () => Promise<void>
  logout: () => Promise<void>
  toast: (text: string, tone?: Toast['tone']) => void
  dismissToast: (id: number) => void
  toggleTheme: () => void
}

let toastSeq = 0

export const useApp = create<State>((set, get) => ({
  account: null,
  loggedIn: false,
  ready: false,
  serverOnline: true,
  unread: { at: 0, like: 0, reply: 0, systemMsg: 0, dm: 0 },
  toasts: [],
  theme: (localStorage.getItem('bili.theme') as 'dark' | 'light') || 'dark',

  refreshMe: async () => {
    try {
      const me = await api.get('/api/auth/me')
      set({
        account: me.account,
        loggedIn: me.loggedIn,
        coins: me.coins,
        ready: true,
        serverOnline: true,
      })
      if (me.loggedIn) get().refreshUnread()
    } catch (err) {
      // A dead server must not be reported as "you are logged out": the session
      // is still on disk and comes back the moment the server does.
      if (err instanceof ApiError && err.offline) {
        set({ ready: true, serverOnline: false })
        return
      }
      set({ account: null, loggedIn: false, ready: true, serverOnline: true })
    }
  },

  retryConnection: async () => {
    const alive = await ping()
    set({ serverOnline: alive })
    if (alive) await get().refreshMe()
    return alive
  },

  refreshUnread: async () => {
    try {
      set({ unread: await api.get('/api/me/unread') })
    } catch {
      // Unread badges are decoration; a failure here must not break the shell.
    }
  },

  logout: async () => {
    await api.post('/api/auth/logout', { mid: get().account?.mid })
    set({ account: null, loggedIn: false })
    get().toast('已登出', 'ok')
  },

  toast: (text, tone = 'info') => {
    const id = ++toastSeq
    set({ toasts: [...get().toasts, { id, text, tone }] })
    setTimeout(() => get().dismissToast(id), 3600)
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  setServerOnline: (online: boolean) => {
    if (get().serverOnline !== online) set({ serverOnline: online })
    // Coming back up: pull the session again so the header stops looking
    // logged out the moment the server returns.
    if (online && !get().loggedIn) get().refreshMe()
  },

  toggleTheme: () => {
    const theme = get().theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme
    localStorage.setItem('bili.theme', theme)
    set({ theme })
  },
}))

// Any request failing with a network error flips the whole app to "offline",
// so the banner appears immediately rather than on the next scheduled probe.
onConnectivity((online) => useApp.getState().setServerOnline(online))
