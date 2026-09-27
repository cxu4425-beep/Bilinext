import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const ROOT = path.resolve(here, '..', '..')
export const DATA_DIR = process.env.BILI_DATA_DIR || path.join(ROOT, 'data')
export const WEB_DIST = path.join(ROOT, 'web', 'dist')

export const PORT = Number(process.env.PORT || 8787)
// A logged-in instance can perform account writes on behalf of its owner.
// Keep that control plane on this computer by default; exposing it to the LAN
// is an explicit opt-in for people who intend to use the phone/PWA client.
export const HOST = process.env.HOST || '127.0.0.1'

/**
 * Optional shared key guarding every /api call. Empty by default, because on
 * this computer (and on your own Wi-Fi) the network itself is the boundary.
 * Set it before putting the server on the public internet: this instance is
 * signed in to a bilibili account and can act as it, so without a key the URL
 * alone is the account. start-bilinext-tunnel.cmd generates one.
 */
export const ACCESS_KEY = process.env.BILI_ACCESS_KEY || ''

/**
 * Extra browser origins allowed to call the API, comma separated. Needed when
 * the front end is hosted somewhere else than the server -- GitHub Pages, say.
 */
export const EXTRA_ORIGINS = (process.env.BILI_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean)

/**
 * Bilibili's edge rejects requests that don't look like they came from its own
 * web player: it checks Referer/Origin on the API and, more strictly, on the
 * CDN that serves the actual media segments. A browser cannot forge Referer,
 * which is the whole reason this server exists as a proxy.
 */
export const BILI_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  referer: 'https://www.bilibili.com',
  origin: 'https://www.bilibili.com',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
}

export const ENDPOINTS = {
  api: 'https://api.bilibili.com',
  passport: 'https://passport.bilibili.com',
  vc: 'https://api.vc.bilibili.com',
  live: 'https://api.live.bilibili.com',
  member: 'https://member.bilibili.com',
}

/** Hosts we are willing to reverse-proxy media for. */
export const MEDIA_HOST_ALLOWLIST = [
  /\.bilivideo\.com$/,
  /\.bilivideo\.cn$/,
  /\.akamaized\.net$/,
  /\.hdslb\.com$/,
  /\.bilibili\.com$/,
]
