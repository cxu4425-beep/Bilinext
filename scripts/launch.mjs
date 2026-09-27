/**
 * One launcher for every way BiliNext gets used.
 *
 * There used to be three start scripts -- this computer only, the Wi-Fi, and a
 * public tunnel -- and picking the wrong one just looked like "the app is
 * broken". This starts the server once, reachable from all three, and prints
 * the addresses that actually work along with a QR code the phone can scan.
 *
 * Because the server is reachable from the Wi-Fi it is always key-guarded: the
 * instance is signed in to a bilibili account, so "anyone on this network" is
 * too wide a door to leave open. The key is generated once and kept in data/.
 */
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT || 8787)
const DATA = path.join(ROOT, 'data')
const KEY_FILE = path.join(DATA, 'access-key')
const PAGES_ORIGIN = 'https://cxu4425-beep.github.io'
const WIN = process.platform === 'win32'

const line = (s = '') => console.log(s)
const rule = () => line('  ' + '-'.repeat(62))

/* --------------------------------------------------------------- the key */

function accessKey() {
  fs.mkdirSync(DATA, { recursive: true })
  if (fs.existsSync(KEY_FILE)) {
    const existing = fs.readFileSync(KEY_FILE, 'utf8').trim()
    if (existing) return existing
  }
  // Short enough to type on a phone if the QR is not an option, long enough
  // that guessing it is hopeless.
  const key = crypto.randomBytes(12).toString('hex')
  fs.writeFileSync(KEY_FILE, key + '\n', { mode: 0o600 })
  return key
}

/* ------------------------------------------------------------ addresses */

/**
 * The address other devices on the Wi-Fi can reach. Picking the interface is
 * the whole problem: a developer machine also has VMware, WSL and Hyper-V
 * adapters with private addresses that lead nowhere. The one with a default
 * gateway is the real one, so Windows is asked directly; the heuristic is only
 * a fallback.
 */
function lanAddress() {
  if (WIN) {
    const ps = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "(Get-NetIPConfiguration).Where({$_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up'})[0].IPv4Address.IPAddress",
      ],
      { encoding: 'utf8' },
    )
    const found = (ps.stdout || '').trim()
    if (/^\d+\.\d+\.\d+\.\d+$/.test(found)) return found
  }
  const candidates = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
  // A virtual adapter is usually the .1 of its own little subnet.
  return candidates.find((a) => !a.endsWith('.1')) || candidates[0] || null
}

/* ------------------------------------------------------------- the tunnel */

function cloudflaredPath() {
  const found = spawnSync(WIN ? 'where' : 'which', ['cloudflared'], { encoding: 'utf8' })
  const first = (found.stdout || '').split(/\r?\n/)[0].trim()
  if (first) return first
  const fallback = WIN ? 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe' : null
  return fallback && fs.existsSync(fallback) ? fallback : null
}

/**
 * Starts a quick tunnel and resolves with its address. cloudflared prints the
 * URL to stderr among its startup logs, and there is no other way to learn it,
 * so the output is scanned for it.
 */
function startTunnel(bin) {
  return new Promise((resolve) => {
    const proc = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.push(proc)
    let settled = false
    const scan = (chunk) => {
      const m = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (m && !settled) {
        settled = true
        resolve({ url: m[0], proc })
      }
    }
    proc.stdout.on('data', scan)
    proc.stderr.on('data', scan)
    proc.on('exit', () => !settled && ((settled = true), resolve(null)))
    // Do not hold up the whole launch if Cloudflare is having a bad day.
    setTimeout(() => !settled && ((settled = true), resolve(null)), 25_000)
  })
}

/* ---------------------------------------------------------------- startup */

const children = []
let shuttingDown = false

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    try {
      child.kill()
    } catch {
      /* already gone */
    }
  }
  process.exit(code)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

const health = async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { cache: 'no-store' })
    return res.ok
  } catch {
    return false
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForServer(timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (await health()) return true
    await wait(400)
  }
  return false
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: WIN })
  return res.status === 0
}

async function main() {
  // Already running: starting a second copy would only fail on the port bind.
  if (await health()) {
    line()
    line('  BiliNext is already running.')
    line(`  Open http://localhost:${PORT} -- and keep the other window open.`)
    line()
    return
  }

  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    line('  Installing dependencies, this happens only once...')
    if (!run('npm', ['install'])) return shutdown(1)
  }
  if (!fs.existsSync(path.join(ROOT, 'web', 'dist', 'index.html'))) {
    line('  Building the web app...')
    if (!run('npm', ['run', 'build'])) return shutdown(1)
  }

  const key = accessKey()
  const server = spawn(process.execPath, [path.join('server', 'src', 'index.js')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      // Every interface, because the phone and the tunnel both need in. The
      // access key is what keeps that safe.
      HOST: '0.0.0.0',
      PORT: String(PORT),
      BILI_ACCESS_KEY: key,
      BILI_ALLOWED_ORIGINS: PAGES_ORIGIN,
      LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
    },
  })
  children.push(server)
  server.on('exit', (code) => {
    if (!shuttingDown) {
      line()
      line(`  Server stopped (exit code ${code}).`)
      shutdown(code ?? 0)
    }
  })

  if (!(await waitForServer())) {
    line('  The server did not come up. Check the messages above.')
    return shutdown(1)
  }

  const lan = lanAddress()
  const bin = cloudflaredPath()
  let tunnel = null
  if (bin) {
    line('  Opening a public tunnel...')
    tunnel = await startTunnel(bin)
  }

  const setupLink = (base) => `${base}/#/setup?key=${key}`
  const best = tunnel?.url || (lan ? `http://${lan}:${PORT}` : `http://localhost:${PORT}`)

  line()
  rule()
  line('  BiliNext is running. Keep this window open.')
  rule()
  line(`  On this computer   http://localhost:${PORT}`)
  if (lan) line(`  On your Wi-Fi      http://${lan}:${PORT}`)
  if (tunnel) line(`  From anywhere      ${tunnel.url}`)
  line()
  line(`  Access key         ${key}`)
  if (!tunnel) {
    line()
    line(bin ? '  The tunnel did not start; only local addresses work.' : '  No public address: cloudflared is not installed.')
    line('      winget install --id Cloudflare.cloudflared -e')
  }
  rule()
  line('  Scan with your phone to open the app with the key already filled in:')
  line(`  ${setupLink(best)}`)
  line()
  line(await QRCode.toString(setupLink(best), { type: 'terminal', small: true }))
  if (tunnel) {
    line('  Note: this public address changes every time you start BiliNext.')
  }
  rule()
  line()
}

main().catch((err) => {
  console.error(err)
  shutdown(1)
})
