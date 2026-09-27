import { store } from '../util/store.js'
import { generateQr, logout, pollQr } from '../bili/login.js'
import { getNav, getNavStat } from '../bili/api.js'
import { isLoggedIn } from '../bili/client.js'
import { IMG, viaProxy } from '../util/images.js'

export default async function authRoutes(app) {
  app.get('/api/auth/qr', async () => generateQr())

  app.get('/api/auth/qr/poll', async (req) => pollQr(req.query.key))

  app.get('/api/auth/me', async () => {
    const account = store.activeAccount()
    if (!account) return { loggedIn: false, account: null }

    try {
      const [nav, stat] = await Promise.all([getNav(), getNavStat().catch(() => null)])
      const merged = store.saveAccount({
        ...account,
        name: nav.uname,
        // Stored raw so a later re-proxy can pick a different size; the browser
        // is only ever handed the proxied, cropped form below.
        face: nav.face,
        level: nav.level_info?.current_level,
      })
      const { cookies, refreshToken, ...safe } = merged
      return {
        loggedIn: Boolean(nav.isLogin),
        account: { ...safe, face: viaProxy(safe.face, 'image', IMG.avatar) },
        coins: nav.money,
        stat,
      }
    } catch (err) {
      // An expired SESSDATA should read as "logged out", not as a crash.
      return { loggedIn: false, account: null, error: err.message }
    }
  })

  app.get('/api/auth/accounts', async () => ({
    accounts: store
      .listAccounts()
      .map((a) => ({ ...a, face: viaProxy(a.face, 'image', IMG.avatar) })),
    activeMid: store.all.activeMid,
  }))

  app.post('/api/auth/switch', async (req) => {
    const acc = store.switchAccount(String(req.body.mid))
    if (!acc) return { ok: false, error: 'unknown account' }
    const { cookies, refreshToken, ...safe } = acc
    return { ok: true, account: { ...safe, face: viaProxy(safe.face, 'image', IMG.avatar) } }
  })

  app.post('/api/auth/logout', async (req) => {
    const mid = String(req.body?.mid || store.all.activeMid || '')
    if (mid) await logout(mid)
    return { ok: true }
  })

  app.get('/api/auth/status', async () => ({ loggedIn: isLoggedIn() }))

  app.get('/api/settings', async () => store.settings)
  app.post('/api/settings', async (req) => store.setSettings(req.body || {}))
}
