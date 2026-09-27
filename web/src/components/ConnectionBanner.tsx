import { useEffect, useState } from 'react'
import { useApp } from '@/store/app'

/**
 * The front end is a static bundle, so it keeps loading from the browser cache
 * long after the local server has stopped. Without this banner the app just
 * looks logged out with an empty feed, which is a confusing way to say "the
 * server is not running".
 */
export default function ConnectionBanner() {
  const { serverOnline, retryConnection } = useApp()
  const [busy, setBusy] = useState(false)

  // Keep probing quietly so the app heals itself once the server comes back.
  useEffect(() => {
    if (serverOnline) return
    const id = setInterval(() => retryConnection(), 5000)
    return () => clearInterval(id)
  }, [serverOnline, retryConnection])

  if (serverOnline) return null

  return (
    <div
      role="alert"
      className="sticky top-14 z-30 border-b border-amber-500/40 bg-amber-500/12 backdrop-blur-md"
    >
      <div className="mx-auto max-w-[1600px] px-3 sm:px-5 py-2.5 flex items-center gap-3 flex-wrap">
        <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0 animate-pulse" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-200">連不上本機伺服器</p>
          <p className="text-[11px] text-amber-200/70">
            你的登入沒有掉,只是後端沒在跑。在專案資料夾執行{' '}
            <code className="px-1 rounded bg-black/30">start-bilinext.cmd</code>(或{' '}
            <code className="px-1 rounded bg-black/30">npm start</code>)後會自動恢復。
          </p>
        </div>
        <button
          onClick={async () => {
            setBusy(true)
            await retryConnection()
            setBusy(false)
          }}
          disabled={busy}
          className="shrink-0 h-8 px-3.5 rounded-full border border-amber-400/50 hover:bg-amber-400/15 text-amber-100 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {busy ? '重試中…' : '立即重試'}
        </button>
      </div>
    </div>
  )
}
