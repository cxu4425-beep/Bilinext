import { useState } from 'react'
import { setServerKey, setServerUrl } from '@/api/client'

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
  // A public host (a tunnel, a VPS) is reached on the standard port; only a
  // bare LAN address gets the server's own port appended.
  const bare = withScheme.replace(/^https?:\/\//, '')
  const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(bare)
  if (/:\d+$/.test(withScheme) || (!isIp && withScheme.startsWith('https://'))) return withScheme
  return `${withScheme}:${PORT}`
}

type Probe = { ok: true; version: string; needsKey: boolean }

/**
 * Probes one address. A reachable-but-wrong host (a printer, the router's admin
 * page) answers something that is not our health payload, so the version field
 * is what proves it is actually BiliNext and not just an open port. Health is
 * answered without a key on purpose, so this can report "right address, but it
 * wants a key" instead of a flat failure.
 */
async function probe(base: string, timeout = HEALTH_TIMEOUT): Promise<Probe | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(`${base}/api/health`, { signal: ctrl.signal, cache: 'no-store' })
    const body = await res.json()
    return body?.ok === true
      ? { ok: true, version: String(body.version ?? ''), needsKey: Boolean(body.needsKey) }
      : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Confirms a key before storing it, so a typo is caught here and not later. */
async function keyWorks(base: string, key: string) {
  try {
    const res = await fetch(`${base}/api/auth/me`, {
      headers: { 'x-bili-key': key },
      cache: 'no-store',
    })
    return res.status !== 401
  } catch {
    return false
  }
}

/**
 * First run of the Android app, and of the GitHub Pages build. Both ship only
 * the front end, so until they are told where the server runs every request
 * fails identically and the app looks broken rather than unconfigured.
 *
 * Nobody knows their PC's LAN address off-hand, so the scan is offered first:
 * it walks the usual home subnets looking for something that answers
 * /api/health. It is deliberately behind a button -- a few hundred requests on
 * someone's network should be something they asked for.
 */
export default function ServerSetup() {
  const [value, setValue] = useState('')
  const [key, setKey] = useState('')
  const [keyNeeded, setKeyNeeded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null)

  const accept = (base: string, version: string, withKey: string) => {
    setServerUrl(base)
    setServerKey(withKey)
    setNote({ text: `已連上 ${base}(v${version}),正在開啟…` })
    // The API address is read once at start-up, so the app has to start over.
    setTimeout(() => window.location.reload(), 700)
  }

  /** Shared by the address form and the scanner once a server has answered. */
  const finish = async (base: string, hit: Probe) => {
    if (!hit.needsKey) return accept(base, hit.version, '')
    setKeyNeeded(true)
    if (!key.trim()) {
      setNote({ text: '這台伺服器需要存取金鑰,請填在下面。', bad: true })
      return
    }
    if (!(await keyWorks(base, key.trim()))) {
      setNote({ text: '金鑰不正確。', bad: true })
      return
    }
    accept(base, hit.version, key.trim())
  }

  const connect = async () => {
    const base = normalise(value)
    if (!base) return
    setBusy(true)
    setNote(null)
    const hit = await probe(base, 4000)
    if (hit) await finish(base, hit)
    else
      setNote({
        text: `${base} 沒有回應。確認電腦上的 BiliNext 伺服器正在執行,且手機和電腦連到同一個 Wi-Fi。`,
        bad: true,
      })
    setBusy(false)
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
    const found: { at: { base: string; hit: Probe } | null } = { at: null }
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
          found.at = { base, hit }
          return
        }
      }
    }
    await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker))
    setScanning(false)
    if (found.at) await finish(found.at.base, found.at.hit)
    else
      setNote({
        text: '沒有找到伺服器。請在電腦上執行 start-bilinext-lan.cmd,它會顯示要輸入的位址。',
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
            這個 App 需要連到你執行 BiliNext 伺服器的機器。
            <br />
            同一個 Wi-Fi 就填電腦的區網位址,從外面連就填你的公開網址。
          </p>
        </div>

        <div className="space-y-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && connect()}
            placeholder="192.168.1.20 或 https://xxx.trycloudflare.com"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={disabled}
            className="input w-full h-11 text-center text-base"
          />
          <p className="text-xs dim text-center">只輸入區網 IP 時會自動補上 :{PORT}</p>

          {keyNeeded && (
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && connect()}
              placeholder="存取金鑰"
              type="password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={disabled}
              className="input w-full h-11 text-center text-base"
            />
          )}

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
