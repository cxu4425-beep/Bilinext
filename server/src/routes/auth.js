import { MULTI_USER } from '../config.js'
import { store } from '../util/store.js'
import { generateQr, logout, pollQr } from '../bili/login.js'
import { getNav, getNavStat } from '../bili/api.js'
import { currentAccount, isLoggedIn } from '../bili/client.js'
import { currentToken } from '../util/ctx.js'
import { IMG, viaProxy } from '../util/images.js'

export default async function authRoutes(app) {
  /**
   * One QR code per visitor every few seconds is far more than a person
   * needs. The cap exists for browsers still running a build that asked for a
   * new code on every re-render: their flood is turned away here, quietly,
   * before it can reach bilibili or fill the log. Behind the tunnel every
   * request comes from 127.0.0.1, so Cloudflare's client address is the key.
   */
  const lastQr = new Map()
  app.get('/api/auth/qr', async (req, reply) => {
    const who = String(req.headers['cf-connecting-ip'] || req.ip)
    const now = Date.now()
    if (now - (lastQr.get(who) || 0) < 3000) {
      return reply.code(429).send({ error: '請求太頻繁,請稍候再按一次', code: -429 })
    }
    lastQr.set(who, now)
    if (lastQr.size > 5000) lastQr.clear()
    return generateQr()
  })

  /**
   * A successful scan is what creates a session: the token it returns is how
   * every later request says which account it is acting as.
   */
  app.get('/api/auth/qr/poll', async (req) => {
    const res = await pollQr(req.query.key)
    if (res.status === 'ok' && MULTI_USER) res.session = store.createSession(res.mid)
    return res
  })

  app.get('/api/auth/me', async () => {
    const account = currentAccount()
    if (!account) return { loggedIn: false, account: null, multiUser: MULTI_USER }

    try {
      const [nav, stat] = await Promise.all([getNav(), getNavStat().catch(() => null)])
      const merged = store.saveAccount(
        {
          ...account,
          name: nav.uname,
          // Stored raw so a later re-proxy can pick a different size; the browser
          // is only ever handed the proxied, cropped form below.
          face: nav.face,
          level: nav.level_info?.current_level,
        },
        { makeActive: !MULTI_USER },
      )
      const { cookies, refreshToken, ...safe } = merged
      return {
        loggedIn: Boolean(nav.isLogin),
        account: { ...safe, face: viaProxy(safe.face, 'image', IMG.avatar) },
        coins: nav.money,
        stat,
        multiUser: MULTI_USER,
      }
    } catch (err) {
      // An expired SESSDATA should read as "logged out", not as a crash.
      return { loggedIn: false, account: null, error: err.message, multiUser: MULTI_USER }
    }
  })

  /**
   * Account switching is a single-user convenience. Sharing the server means
   * the list of everyone signed in is nobody else's business, so each session
   * only ever sees its own account.
   */
  app.get('/api/auth/accounts', async () => {
    const accounts = MULTI_USER
      ? [currentAccount()].filter(Boolean).map(({ cookies, refreshToken, ...safe }) => safe)
      : store.listAccounts()
    return {
      accounts: accounts.map((a) => ({ ...a, face: viaProxy(a.face, 'image', IMG.avatar) })),
      activeMid: MULTI_USER ? (currentAccount()?.mid ?? null) : store.all.activeMid,
      multiUser: MULTI_USER,
    }
  })

  app.post('/api/auth/switch', async (req, reply) => {
    if (MULTI_USER) return reply.code(403).send({ error: '這台伺服器不支援切換帳號' })
    const acc = store.switchAccount(String(req.body.mid))
    if (!acc) return { ok: false, error: 'unknown account' }
    const { cookies, refreshToken, ...safe } = acc
    return { ok: true, account: { ...safe, face: viaProxy(safe.face, 'image', IMG.avatar) } }
  })

  /**
   * Signing out takes the stored bilibili cookies with it, not just the
   * session: leaving someone's credentials on a stranger's machine after they
   * asked to leave would be the wrong default.
   */
  app.post('/api/auth/logout', async (req) => {
    if (MULTI_USER) {
      const mid = currentAccount()?.mid
      store.deleteSession(currentToken())
      if (mid) {
        store.revokeSessions(mid)
        await logout(mid)
      }
      return { ok: true }
    }
    const mid = String(req.body?.mid || store.all.activeMid || '')
    if (mid) await logout(mid)
    return { ok: true }
  })

  app.get('/api/auth/status', async () => ({ loggedIn: isLoggedIn() }))

  app.get('/api/settings', async () => store.settings)
  app.post('/api/settings', async (req) => store.setSettings(req.body || {}))
}
