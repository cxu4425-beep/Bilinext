import { useState } from 'react'
import { setServerUrl } from '@/api/client'

const PORT = 8787
const HEALTH_TIMEOUT = 1500

/** The subnets a home router hands out; anything else the user types in. */
const SUBNETS = ['192.168.0', '192.168.1', '192.168.2', '192.168.31', '10.0.0']
const SCAN_CONCURRENCY = 48

const normalise = (raw: string) => {
  const s = raw.trim().replace(/\/+$/, '')
  if (!s) return ''
  // A bare address is the common case -- typing "http://" and a port on a phone
  // keyboard is exactly the friction this screen exists to remove.
  const withScheme = /^https?:\/\//.test(s) ? s : `http://${s}`
  return /:\d+$/.test(withScheme) ? withScheme : `${withScheme}:${PORT}`
}

/**
 * Probes one address. A reachable-but-wrong host (a printer, the router's admin
 * page) answers something that is not our health payload, so the version field
 * is what proves it is actually BiliNext and not just an open port.
 */
async function probe(base: string, timeout = HEALTH_TIMEOUT) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(`${base}/api/health`, { signal: ctrl.signal, cache: 'no-store' })
    const body = await res.json()
    return body?.ok === true ? { ok: true as const, version: String(body.version ?? '') } : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * First run of the Android app. The APK ships only the front end, so until it
 * is told where the Node server runs every request fails identically and the
 * app looks broken rather than unconfigured.
 *
 * Nobody knows their PC's LAN address off-hand, so the scan is offered first:
 * it walks the usual home subnets looking for something that answers
 * /api/health. It is deliberately behind a button -- a few hundred requests on
 * someone's network should be something they asked for.
 */
export default function ServerSetup() {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)

  const accept = (base: string, version: string) => {
    setServerUrl(base)
    setNote({ text: `已連上 ${base}(v${version}),正在開啟…` })
    // BASE is read once at module load, so the app has to start over.
    setTimeout(() => window.location.reload(), 700)
  }

  const connect = async () => {
    const base = normalise(value)
    if (!base) return
    setBusy(true)
    setNote(null)
    const hit = await probe(base, 4000)
    setBusy(false)
    if (hit) accept(base, hit.version)
    else setNote({ text: `${base} 沒有回應。確認電腦上的 BiliNext 伺服器正在執行,且手機和電腦連到同一個 Wi-Fi。`, bad: true })
  }

  const scan = async () => {
    setScanning(true)
    setNote(null)
    setProgress(0)
    const targets: string[] = []
    for (const net of SUBNETS) for (let h = 1; h <= 254; h++) targets.push(`http://${net}.${h}:${PORT}`)

    let next = 0
    let done = 0
    // Held in an object rather than a plain `let`: the workers assign to it
    // from inside a closure, and TypeScript's narrowing does not follow that.
    const found: { at: { base: string; version: string } | null } = { at: null }
    // A fixed pool rather than Promise.all over 1,270 addresses: the WebView
    // would queue them anyway, and this lets the first hit stop the rest.
    const worker = async () => {
      while (!found.at) {
        const i = next++
        if (i >= targets.length) return
        const base = targets[i]
        const hit = await probe(base, 700)
        done++
        if (done % 20 === 0) setProgress(Math.round((done / targets.length) * 100))
        if (hit) {
          found.at = { base, version: hit.version }
          return
        }
      }
    }
    await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker))
    setScanning(false)
    if (found.at) accept(found.at.base, found.at.version)
    else
      setNote({
        text: '沒有找到伺服器。請在電腦上執行 start-bilinext.cmd,它會顯示要輸入的位址。',
        bad: true,
      })
  }

  const disabled = busy || scanning

  return (
    <div className="min-h-dvh flex items-center justify-center p-5">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center space-y-1.5">
          <h1 className="text-2xl font-bold">BiliNext</h1>
          <p className="text-sm dim leading-relaxed">
            這個 App 需要連到你電腦上執行的 BiliNext 伺服器。
            <br />
            先在電腦執行 <code>start-bilinext.cmd</code>,再輸入它顯示的位址。
          </p>
        </div>

        <div className="space-y-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && connect()}
            placeholder="192.168.1.20"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={disabled}
            className="input w-full h-11 text-center text-base"
          />
          <p className="text-xs dim text-center">可以只輸入 IP,會自動補上 :{PORT}</p>
          <button
            onClick={connect}
            disabled={disabled || !value.trim()}
            className="w-full h-11 rounded-lg bg-[var(--accent)] text-white font-medium disabled:opacity-40"
          >
            {busy ? '連線中…' : '連線'}
          </button>
          <button
            onClick={scan}
            disabled={disabled}
            className="w-full h-11 rounded-lg surface text-sm disabled:opacity-40"
          >
            {scanning ? `搜尋中… ${progress}%` : '自動搜尋同一個 Wi-Fi 上的電腦'}
          </button>
        </div>

        {note && (
          <p
            className={`text-xs leading-relaxed text-center ${
              note.bad ? 'text-red-400' : 'text-emerald-400'
            }`}
          >
            {note.text}
          </p>
        )}
      </div>
    </div>
  )
}
