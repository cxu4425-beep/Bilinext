import { request } from 'undici'
import { BILI_HEADERS, ENDPOINTS, MAX_ACCOUNTS, MULTI_USER } from '../config.js'
import { store } from '../util/store.js'
import { withAccount } from '../util/ctx.js'
import { BiliError, bili, refreshDeviceIdentity } from './client.js'
import { IMG, viaProxy } from '../util/images.js'

const POLL_MESSAGES = {
  0: 'ok',
  86038: 'QR code 已過期,請重新產生',
  86090: '已掃碼,請在手機上確認登入',
  86101: '等待掃碼',
}

/**
 * QR login is deliberately the only supported path: the password never leaves
 * the official app, and this client only ever receives the resulting cookies.
 */
/**
 * When the login endpoint has walled this address, nothing here can talk it
 * round -- and every further attempt spends more of the quota that decides
 * when it reopens. Verified: the plain call, the call with the real login
 * page's parameters, and the call with a fresh device identity and a passport
 * Referer all get the same 412 wall. So the door is simply held shut for a
 * while, and the wait is reported instead of being turned into more traffic.
 */
let wallUntil = 0

export async function generateQr() {
  const waitSeconds = Math.ceil((wallUntil - Date.now()) / 1000)
  if (waitSeconds > 0) {
    throw new BiliError(
      -352,
      `bilibili 暫時擋下了登入請求,請等約 ${waitSeconds} 秒再試(一直重試會讓封鎖變長)`,
    )
  }

  const ask = async () => {
    const data = await bili.get(`${ENDPOINTS.passport}/x/passport-login/web/qrcode/generate`)
    return { url: data.url, key: data.qrcode_key }
  }
  try {
    return await ask()
  } catch (err) {
    if (err?.crawlerWall) {
      wallUntil = Date.now() + 90_000
      throw new BiliError(
        -352,
        'bilibili 暫時擋下了登入請求(反爬蟲牆)。請等約 90 秒再按一次登入 —— 反覆重試會延長封鎖。',
      )
    }
    // Risk control attaches to the anonymous device identity, and a flagged one
    // stays flagged -- every later attempt fails identically until it is
    // replaced. That is fatal here in a way it is not elsewhere: this is the
    // endpoint people need in order to sign in at all, so a "come back later"
    // leaves them with no way in. Rebuilding the identity is rate limited to
    // once a minute inside refreshDeviceIdentity.
    if (err?.code === -352 && (await refreshDeviceIdentity())) return ask()
    throw err
  }
}

export async function pollQr(qrcodeKey) {
  const target = new URL(`${ENDPOINTS.passport}/x/passport-login/web/qrcode/poll`)
  target.searchParams.set('qrcode_key', qrcodeKey)

  // Read cookies off the raw response: the login credentials arrive only as
  // Set-Cookie headers, not in the JSON body.
  const res = await request(target, { headers: BILI_HEADERS })
  const body = await res.body.json()
  const code = body?.data?.code

  if (code !== 0) {
    return { status: 'pending', code, message: POLL_MESSAGES[code] || body?.data?.message || '等待掃碼' }
  }

  const raw = res.headers['set-cookie']
  const lines = Array.isArray(raw) ? raw : raw ? [raw] : []
  const cookies = {}
  for (const line of lines) {
    const [pair] = line.split(';')
    const i = pair.indexOf('=')
    if (i > 0) cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim()
  }
  if (!cookies.SESSDATA) {
    return { status: 'pending', code: -1, message: '登入回應缺少憑證,請重試' }
  }

  // A cap is the only brake on an open server; refusing at the last step is
  // better than storing credentials it was never going to serve.
  if (
    MULTI_USER &&
    MAX_ACCOUNTS &&
    !store.account(cookies.DedeUserID) &&
    store.countAccounts() >= MAX_ACCOUNTS
  ) {
    return { status: 'error', message: '這台伺服器的帳號數已達上限,請聯絡管理者' }
  }

  // refresh_token lets us renew the session later without another scan.
  const account = {
    mid: String(cookies.DedeUserID),
    cookies,
    refreshToken: body.data.refresh_token || null,
    addedAt: Date.now(),
  }
  // Someone else signing in must not move everyone else onto their account,
  // so only single-user mode promotes the newcomer to "the" account.
  const keep = { makeActive: !MULTI_USER }
  store.saveAccount(account, keep)

  // Explicitly as the account that just signed in: with several people on one
  // server there is no current account for this call to inherit.
  const nav = await withAccount(account.mid, () => bili.get('/x/web-interface/nav'))
  const full = store.saveAccount(
    {
      ...account,
      name: nav.uname,
      face: nav.face,
      level: nav.level_info?.current_level,
      vipStatus: nav.vipStatus,
    },
    keep,
  )

  const { cookies: _hidden, refreshToken: _rt, ...safe } = full
  return {
    status: 'ok',
    mid: account.mid,
    account: { ...safe, face: viaProxy(safe.face, 'image', IMG.avatar) },
  }
}

export async function logout(mid) {
  try {
    const csrf = store.all.accounts[mid]?.cookies?.bili_jct
    if (csrf) {
      await bili.post(`${ENDPOINTS.passport}/login/exit/v2`, { biliCSRF: csrf })
    }
  } catch {
    // Revoking server-side is best effort; dropping the local cookies is what
    // actually matters for this machine.
  }
  store.removeAccount(mid)
}
