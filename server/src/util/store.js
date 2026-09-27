import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR } from '../config.js'

const KEY_FILE = path.join(DATA_DIR, 'key')
const DB_FILE = path.join(DATA_DIR, 'store.enc')

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })

/**
 * Session cookies are as good as the password for as long as they live, so the
 * store is encrypted at rest. The key sits in a sibling file with 0600 perms --
 * that stops another local account or a synced backup from reading credentials,
 * which is the realistic threat for a self-hosted personal client. It does not
 * defend against malware already running as you.
 * Set BILI_STORE_KEY (64 hex chars) to keep the key out of the filesystem.
 */
function loadKey() {
  const fromEnv = process.env.BILI_STORE_KEY
  if (fromEnv) {
    const buf = Buffer.from(fromEnv, 'hex')
    if (buf.length !== 32) throw new Error('BILI_STORE_KEY must be 64 hex characters')
    return buf
  }
  if (fs.existsSync(KEY_FILE)) return Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex')
  const key = crypto.randomBytes(32)
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 })
  return key
}

const KEY = loadKey()

function encrypt(plain) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), enc])
}

function decrypt(buf) {
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8')
}

const DEFAULTS = {
  /** mid -> { mid, name, face, cookies: {name: value}, addedAt } */
  accounts: {},
  activeMid: null,
  settings: { preferredQuality: 80, autoplay: true, theme: 'dark', danmakuOn: true },
}

let cache = null

function read() {
  if (cache) return cache
  if (!fs.existsSync(DB_FILE)) {
    cache = structuredClone(DEFAULTS)
    return cache
  }
  try {
    cache = { ...structuredClone(DEFAULTS), ...JSON.parse(decrypt(fs.readFileSync(DB_FILE))) }
  } catch (err) {
    // A rotated key or a truncated write should not brick the app; the only
    // thing lost is the session, and re-scanning the QR restores it.
    console.error('[store] unreadable, starting fresh:', err.message)
    cache = structuredClone(DEFAULTS)
  }
  return cache
}

function flush() {
  fs.writeFileSync(DB_FILE, encrypt(JSON.stringify(cache)), { mode: 0o600 })
}

export const store = {
  get all() {
    return read()
  },
  get settings() {
    return read().settings
  },
  setSettings(patch) {
    Object.assign(read().settings, patch)
    flush()
    return read().settings
  },
  listAccounts() {
    return Object.values(read().accounts).map(({ cookies, ...rest }) => rest)
  },
  activeAccount() {
    const db = read()
    return db.activeMid ? db.accounts[db.activeMid] || null : null
  },
  saveAccount(account) {
    const db = read()
    db.accounts[account.mid] = { ...(db.accounts[account.mid] || {}), ...account }
    db.activeMid = String(account.mid)
    flush()
    return db.accounts[account.mid]
  },
  switchAccount(mid) {
    const db = read()
    if (!db.accounts[mid]) return null
    db.activeMid = String(mid)
    flush()
    return db.accounts[mid]
  },
  removeAccount(mid) {
    const db = read()
    delete db.accounts[mid]
    if (db.activeMid === String(mid)) db.activeMid = Object.keys(db.accounts)[0] || null
    flush()
  },
  /** Merge Set-Cookie values into the active account without dropping existing ones. */
  mergeCookies(mid, cookies) {
    const db = read()
    const acc = db.accounts[mid]
    if (!acc) return
    acc.cookies = { ...acc.cookies, ...cookies }
    flush()
  },
}
