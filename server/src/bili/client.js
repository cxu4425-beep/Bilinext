import crypto from 'node:crypto'
import { request } from 'undici'
import { BILI_HEADERS, ENDPOINTS } from '../config.js'
import { store } from '../util/store.js'
import { createWbi, signParams } from './wbi.js'

export class BiliError extends Error {
  constructor(code, message, payload) {
    super(message || `bilibili error ${code}`)
    this.code = code
    this.payload = payload
    // -101 not logged in, -111 bad csrf, -352 risk control, -403 signature/permission.
    // -400 is a malformed request and deliberately NOT treated as an auth
    // problem: doing so lets our own parameter bugs hide behind a "please log
    // in" fallback instead of being reported.
    this.needsLogin = code === -101 || code === 61000
    this.riskControlled = code === -352 || code === -509
  }
}

function cookieHeader(cookies) {
  return Object.entries(cookies || {})
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

function parseSetCookie(headers) {
  const raw = headers['set-cookie']
  if (!raw) return {}
  const list = Array.isArray(raw) ? raw : [raw]
  const out = {}
  for (const line of list) {
    const [pair] = line.split(';')
    const idx = pair.indexOf('=')
    if (idx > 0) out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
  }
  return out
}

const hex = (n) => crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n).toUpperCase()

/**
 * The web client generates these in JS on first load. Endpoints behind
 * bilibili's risk control (notably the space/arc listing) return -352 when the
 * session looks like it never ran a browser, so they are synthesised here.
 */
function deviceIds() {
  const ts = Date.now()
  return {
    _uuid: `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}${String(ts % 100000).padStart(5, '0')}infoc`,
    b_lsid: `${hex(8)}_${ts.toString(16).toUpperCase()}`,
  }
}

/** Anonymous device cookies. Several list endpoints 352 without a buvid. */
let anonCookies = null
let anonBornAt = 0

/**
 * Risk control attaches to the device identity, so a buvid that has been
 * flagged stays flagged. Throwing it away and bootstrapping a fresh one is the
 * only thing that clears it. Rate limited to once a minute so a genuinely
 * blocked client cannot spin generating identities.
 */
export async function refreshDeviceIdentity() {
  if (Date.now() - anonBornAt < 60_000) return false
  anonCookies = null
  await ensureAnonCookies()
  return true
}
async function ensureAnonCookies() {
  if (anonCookies) return anonCookies
  anonCookies = { ...deviceIds() }
  try {
    const res = await request('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: BILI_HEADERS,
    })
    const body = await res.body.json()
    if (body?.data?.b_3) anonCookies.buvid3 = body.data.b_3
    if (body?.data?.b_4) anonCookies.buvid4 = body.data.b_4
  } catch {
    // Non-fatal: most endpoints still answer without a buvid.
  }
  anonCookies.b_nut = String(Math.floor(Date.now() / 1000))
  anonBornAt = Date.now()

  // Activating the buvid is what actually clears risk control on the space
  // endpoints; without it a fresh buvid3 is still treated as untrusted.
  try {
    await request('https://api.bilibili.com/x/internal/gaia-gateway/ExClimbWuzhi', {
      method: 'POST',
      headers: {
        ...BILI_HEADERS,
        'content-type': 'application/json',
        cookie: Object.entries(anonCookies).map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: JSON.stringify({ payload: JSON.stringify({ '39c8': '333.999.fp.risk' }) }),
    }).then((r) => r.body.dump())
  } catch {
    // Best effort; the listing simply stays rate limited if this is rejected.
  }
  return anonCookies
}

/**
 * WebGL fingerprint parameters the real player attaches to space queries.
 * These are constants in bilibili's own bundle, not per-user values.
 */
export const DM_PARAMS = {
  dm_img_list: '[]',
  dm_img_str: 'V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ',
  dm_cover_img_str:
    'QU5HTEUgKEludGVsLCBJbnRlbChSKSBVSEQgR3JhcGhpY3MgNjMwIERpcmVjdDNEMTEgdnNfNV8wIHBzXzVfMCwgRDNEMTEpR29vZ2xlIEluYy4gKEludGVsKQ',
  dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}',
}

async function currentCookies() {
  const anon = await ensureAnonCookies()
  const acc = store.activeAccount()
  return { ...anon, ...(acc?.cookies || {}) }
}

export function csrfToken() {
  return store.activeAccount()?.cookies?.bili_jct || ''
}

export function isLoggedIn() {
  return Boolean(store.activeAccount()?.cookies?.SESSDATA)
}

async function call(method, url, { params, form, json, headers, raw } = {}) {
  const target = new URL(url)
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null) target.searchParams.set(k, String(v))
  }

  const cookies = await currentCookies()
  const init = {
    method,
    headers: {
      ...BILI_HEADERS,
      cookie: cookieHeader(cookies),
      ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...(json ? { 'content-type': 'application/json' } : {}),
      ...headers,
    }
  }
  if (form) {
    const body = new URLSearchParams()
    for (const [k, v] of Object.entries(form)) {
      if (v !== undefined && v !== null) body.set(k, String(v))
    }
    init.body = body.toString()
  } else if (json) {
    init.body = JSON.stringify(json)
  }

  const res = await request(target, init)

  const fresh = parseSetCookie(res.headers)
  const acc = store.activeAccount()
  if (acc && Object.keys(fresh).length) store.mergeCookies(acc.mid, fresh)

  if (raw) return res

  const text = await res.body.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    // An HTML body here is bilibili's anti-crawler wall (usually served as 412),
    // not a malformed response. Report it as the rate limit it actually is so
    // the UI can tell the user to slow down instead of showing a page of HTML.
    if (res.statusCode === 412 || text.trimStart().startsWith('<')) {
      throw new BiliError(-352, '被 bilibili 風控攔截,請稍後再試(請求過於頻繁)')
    }
    throw new BiliError(-1, `non-JSON response from ${target.pathname}: ${text.slice(0, 200)}`)
  }
  if (parsed.code !== 0 && parsed.code !== undefined) {
    throw new BiliError(parsed.code, parsed.message || parsed.msg, parsed)
  }
  return parsed.data ?? parsed
}

export const bili = {
  get: (path, params, opts) => call('GET', path.startsWith('http') ? path : ENDPOINTS.api + path, { params, ...opts }),
  post: (path, form, opts) =>
    call('POST', path.startsWith('http') ? path : ENDPOINTS.api + path, { form, ...opts }),
  postJson: (path, json, opts) =>
    call('POST', path.startsWith('http') ? path : ENDPOINTS.api + path, { json, ...opts }),
  raw: (url, opts) => call(opts?.method || 'GET', url, { ...opts, raw: true }),
}

const getMixin = createWbi(() => bili.get('/x/web-interface/nav').catch((e) => e.payload?.data))

/** GET with a WBI signature, retrying once against freshly fetched keys. */
export async function signedGet(path, params = {}) {
  const attempt = async (force) => {
    const mixin = await getMixin(force)
    return bili.get(path, signParams(params, mixin))
  }
  try {
    return await attempt(false)
  } catch (err) {
    if (!(err instanceof BiliError)) throw err
    // Stale WBI keys.
    if (err.code === -403 || err.code === -401) return attempt(true)
    // Flagged device: rebuild the identity and try once more.
    if (err.riskControlled && (await refreshDeviceIdentity())) return attempt(true)
    throw err
  }
}

/** POST that automatically attaches the CSRF token bilibili requires on writes. */
export function csrfPost(path, form = {}, opts) {
  const csrf = csrfToken()
  if (!csrf) throw new BiliError(-101, '尚未登入,無法執行寫入操作')
  return bili.post(path, { ...form, csrf }, opts)
}
