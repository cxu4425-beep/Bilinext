/**
 * True only in the Android build. The Capacitor shell serves the app from
 * http://localhost, which is indistinguishable at runtime from a normal
 * browser tab, so this is decided at build time: `vite build --mode capacitor`
 * loads web/.env.capacitor, which sets VITE_NATIVE. An earlier runtime check
 * for a `capacitor:` protocol never fired, because capacitor.config.json asks
 * for the http scheme.
 */
export const NATIVE = import.meta.env.VITE_NATIVE === '1'

/**
 * In the browser and in the Tauri shell the API is same-origin (or proxied by
 * Vite). The APK ships only the front end, so it must be told where the server
 * runs -- a PC on the same Wi-Fi, or a VPS. Empty until the user sets it; the
 * setup screen is what stops the app from firing requests at nowhere.
 */
export const serverUrl = () => localStorage.getItem('bili.serverUrl') || ''
const BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? (NATIVE ? serverUrl() : '')

export class ApiError extends Error {
  code?: number
  needsLogin?: boolean
  riskControlled?: boolean
  /** True when the request never reached the server at all. */
  offline: boolean
  status: number
  constructor(status: number, body: any) {
    super(body?.error || (status === 0 ? '連不上伺服器' : `HTTP ${status}`))
    this.status = status
    this.code = body?.code
    // status 0 means fetch itself failed: the server is down, not refusing us.
    this.offline = status === 0
    this.needsLogin = !this.offline && (body?.needsLogin ?? status === 401)
    this.riskControlled = body?.riskControlled ?? status === 429
  }
}

type Options = {
  params?: Record<string, unknown>
  signal?: AbortSignal
  /** Lets a small request finish even if the page is closing. */
  keepalive?: boolean
}

function url(path: string, params?: Record<string, unknown>) {
  const u = new URL(BASE + path, BASE || window.location.origin)
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v))
  }
  return BASE ? u.toString() : u.pathname + u.search
}

async function parse(res: Response) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, body)
  return body
}

/**
 * Connectivity is reported from here rather than inferred by each caller: any
 * request is evidence about whether the server is up, so the banner reacts to
 * the first failure anywhere in the app instead of waiting for a specific
 * probe to run.
 */
type Listener = (online: boolean) => void
const listeners = new Set<Listener>()
export function onConnectivity(cb: Listener) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
const report = (online: boolean) => listeners.forEach((cb) => cb(online))

/**
 * A dead server makes fetch reject with a bare TypeError, which is
 * indistinguishable from a bug at the call site. Normalising it into an
 * ApiError with status 0 lets the UI say "the server is not running" instead of
 * silently rendering an empty page.
 */
function asApiError(err: unknown): never {
  if (err instanceof ApiError) throw err
  if (err instanceof DOMException && err.name === 'AbortError') throw err
  report(false)
  throw new ApiError(0, { error: '連不上伺服器' })
}

/** A completed response -- even a 4xx -- proves the server is answering. */
function seen<T>(value: T): T {
  report(true)
  return value
}

export const api = {
  get: (path: string, opts: Options = {}) =>
    fetch(url(path, opts.params), { signal: opts.signal, credentials: 'include' })
      .then(seen, asApiError)
      .then(parse),

  /**
   * The custom header is what the server uses to reject cross-origin writes --
   * a plain form post from another page cannot set it.
   */
  post: (path: string, body?: unknown, opts: Options = {}) =>
    fetch(url(path, opts.params), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bili-client': 'bili-next' },
      body: JSON.stringify(body ?? {}),
      signal: opts.signal,
      keepalive: opts.keepalive,
      credentials: 'include',
    })
      .then(seen, asApiError)
      .then(parse),

  upload: (path: string, file: File, onProgress?: (pct: number) => void) =>
    new Promise<any>((resolve, reject) => {
      const form = new FormData()
      form.append('file', file)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', url(path))
      xhr.setRequestHeader('x-bili-client', 'bili-next')
      xhr.withCredentials = true
      // fetch() still cannot report request-body progress, so uploads stay on
      // XHR to keep the progress bar honest.
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => {
        let body: any = {}
        try {
          body = JSON.parse(xhr.responseText)
        } catch {
          /* fall through to the status check */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body)
        else reject(new ApiError(xhr.status, body))
      }
      xhr.onerror = () => reject(new ApiError(0, { error: '網路錯誤' }))
      xhr.send(form)
    }),
}

export const setServerUrl = (u: string) => localStorage.setItem('bili.serverUrl', u)

/** Cheap liveness probe used by the reconnect banner. */
export const ping = () =>
  fetch(url('/api/health'), { cache: 'no-store' })
    .then((r) => {
      report(r.ok)
      return r.ok
    })
    .catch(() => {
      report(false)
      return false
    })
