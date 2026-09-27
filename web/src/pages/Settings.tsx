import { useState } from 'react'
import { useApp } from '@/store/app'
import { NATIVE, setServerUrl } from '@/api/client'

/**
 * Mostly here for the packaged Android app: the APK ships only the front end,
 * so it needs to be told where the server lives (a PC on the same Wi-Fi, or a
 * VPS). In the browser the API is same-origin and this field is unused.
 */
export default function Settings() {
  const { theme, toggleTheme, toast } = useApp()
  const [server, setServer] = useState(localStorage.getItem('bili.serverUrl') || '')
  const [autoplay, setAutoplay] = useState(localStorage.getItem('bili.autoplay') !== '0')
  const [checking, setChecking] = useState(false)

  const isPackaged =
    NATIVE || (typeof window !== 'undefined' && window.location.protocol === 'tauri:')

  const test = async () => {
    setChecking(true)
    try {
      const res = await fetch(`${server.replace(/\/$/, '')}/api/health`)
      const body = await res.json()
      toast(body.ok ? `連線成功(v${body.version})` : '回應異常', body.ok ? 'ok' : 'error')
    } catch {
      toast('連不上這個位址', 'error')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="p-3 sm:p-5 max-w-lg space-y-6">
      <h1 className="text-xl font-bold">設定</h1>

      <section>
        <h2 className="text-sm font-medium mb-2">外觀</h2>
        <button
          onClick={toggleTheme}
          className="w-full h-10 rounded-lg surface hover:border-[var(--accent)] text-sm transition-colors"
        >
          目前:{theme === 'dark' ? '深色' : '淺色'}(點擊切換)
        </button>
      </section>

      <section>
        <h2 className="text-sm font-medium mb-2">播放</h2>
        <label className="flex items-center gap-3 p-3 rounded-lg surface cursor-pointer">
          <input
            type="checkbox"
            checked={autoplay}
            onChange={(e) => {
              setAutoplay(e.target.checked)
              localStorage.setItem('bili.autoplay', e.target.checked ? '1' : '0')
            }}
            className="accent-[var(--accent)]"
          />
          <span className="min-w-0">
            <span className="block text-sm">開啟影片後自動播放</span>
            <span className="block text-xs dim mt-0.5">
              若瀏覽器擋下聲音,畫面會照常播放並顯示「點擊開啟聲音」。
            </span>
          </span>
        </label>
      </section>

      <section>
        <h2 className="text-sm font-medium mb-2">伺服器位址</h2>
        <p className="text-xs dim mb-2">
          {isPackaged
            ? '這個 App 需要連到你執行 server 的機器,例如 http://192.168.1.20:8787'
            : '從瀏覽器開啟時不需要設定,前端與 API 同源。'}
        </p>
        <div className="flex gap-2">
          <input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="http://192.168.1.20:8787"
            className="input flex-1"
          />
          <button
            onClick={test}
            disabled={!server || checking}
            className="px-3 h-9 rounded-lg surface text-sm shrink-0 disabled:opacity-40"
          >
            測試
          </button>
        </div>
        <button
          onClick={() => {
            setServerUrl(server.replace(/\/$/, ''))
            toast('已儲存,重新載入中…', 'ok')
            // The API base is read once when the module loads, so a new address
            // only takes effect on a reload. Doing it here saves the user
            // force-quitting the app to make the change stick.
            setTimeout(() => window.location.reload(), 600)
          }}
          disabled={!server}
          className="mt-2 w-full h-10 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-40"
        >
          儲存
        </button>
      </section>

      <section>
        <h2 className="text-sm font-medium mb-2">關於</h2>
        <div className="surface rounded-[var(--radius-card)] p-4 text-xs dim leading-relaxed space-y-2">
          <p>
            BiliNext 是一個第三方 bilibili 客戶端。它透過官方 App 的掃碼流程登入,
            你的密碼不會經過這個程式。
          </p>
          <p>
            登入憑證以 AES-256-GCM 加密存放在伺服器的 <code>data/</code> 目錄。
            要完全清除,登出後刪除該目錄即可。
          </p>
          <p>
            本程式依賴 bilibili 未公開的網頁 API,官方隨時可能變更,
            屆時部分功能會失效並需要更新。
          </p>
        </div>
      </section>
    </div>
  )
}
