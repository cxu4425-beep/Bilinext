import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Draws the app icon straight into a PNG buffer. Doing it in code keeps the
 * repo free of binary assets and means the icon can be regenerated at any size
 * without a design tool in the loop.
 */

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')

const PINK = [251, 114, 153]
const WHITE = [255, 255, 255]
const BG = [15, 17, 23]

const lerp = (a, b, t) => a + (b - a) * t

/** Signed distance to a rounded rectangle, used for anti-aliased edges. */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - r
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r
}

/** Distance to a thick line segment, for the TV antennae. */
function sdSegment(px, py, ax, ay, bx, by, halfWidth) {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
  return Math.hypot(wx - vx * t, wy - vy * t) - halfWidth
}

function render(size, { maskable = false } = {}) {
  const S = size
  const px = new Uint8Array(S * S * 4)
  // A maskable icon must survive an aggressive circular crop, so the artwork
  // shrinks into the safe zone and the plate fills the whole canvas.
  const inset = maskable ? S * 0.18 : S * 0.06
  const plateR = maskable ? S * 0.5 : S * 0.22

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4
      const cx = x + 0.5
      const cy = y + 0.5

      let r = BG[0]
      let g = BG[1]
      let b = BG[2]
      let a = 0

      // Pink plate.
      const dPlate = maskable
        ? sdRoundRect(cx, cy, S / 2, S / 2, S / 2, S / 2, 0)
        : sdRoundRect(cx, cy, S / 2, S / 2, S / 2 - S * 0.04, S / 2 - S * 0.04, plateR)
      const platecov = Math.max(0, Math.min(1, 0.5 - dPlate))
      if (platecov > 0) {
        r = PINK[0]
        g = PINK[1]
        b = PINK[2]
        a = Math.max(a, platecov * 255)
      }

      const bodyH = (S - inset * 2) * 0.46
      const bodyW = (S - inset * 2) * 0.74
      const bodyCY = S / 2 + (S - inset * 2) * 0.09

      // Antennae, drawn before the body so the body caps them cleanly.
      const antTop = bodyCY - bodyH / 2 - (S - inset * 2) * 0.2
      const dAntL = sdSegment(
        cx, cy,
        S / 2 - bodyW * 0.3, bodyCY - bodyH / 2 + S * 0.01,
        S / 2 - bodyW * 0.44, antTop,
        S * 0.035,
      )
      const dAntR = sdSegment(
        cx, cy,
        S / 2 + bodyW * 0.3, bodyCY - bodyH / 2 + S * 0.01,
        S / 2 + bodyW * 0.44, antTop,
        S * 0.035,
      )
      const antCov = Math.max(
        Math.max(0, Math.min(1, 0.5 - dAntL)),
        Math.max(0, Math.min(1, 0.5 - dAntR)),
      )
      if (antCov > 0) {
        r = lerp(r, WHITE[0], antCov)
        g = lerp(g, WHITE[1], antCov)
        b = lerp(b, WHITE[2], antCov)
        a = Math.max(a, antCov * 255)
      }

      // TV body.
      const dBody = sdRoundRect(cx, cy, S / 2, bodyCY, bodyW / 2, bodyH / 2, S * 0.1)
      const bodyCov = Math.max(0, Math.min(1, 0.5 - dBody))
      if (bodyCov > 0) {
        r = lerp(r, WHITE[0], bodyCov)
        g = lerp(g, WHITE[1], bodyCov)
        b = lerp(b, WHITE[2], bodyCov)
        a = Math.max(a, bodyCov * 255)
      }

      // Two eyes punched back out in pink.
      const eyeR = S * 0.052
      const dEye = Math.min(
        sdCircle(cx, cy, S / 2 - bodyW * 0.22, bodyCY, eyeR),
        sdCircle(cx, cy, S / 2 + bodyW * 0.22, bodyCY, eyeR),
      )
      const eyeCov = Math.max(0, Math.min(1, 0.5 - dEye))
      if (eyeCov > 0) {
        r = lerp(r, PINK[0], eyeCov)
        g = lerp(g, PINK[1], eyeCov)
        b = lerp(b, PINK[2], eyeCov)
      }

      px[i] = r
      px[i + 1] = g
      px[i + 2] = b
      px[i + 3] = Math.round(Math.min(255, a))
    }
  }
  return px
}

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function toPng(pixels, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // Each scanline is prefixed with a filter byte; 0 = none.
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

fs.mkdirSync(OUT, { recursive: true })
for (const [name, size, opts] of [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
]) {
  fs.writeFileSync(path.join(OUT, name), toPng(render(size, opts), size))
  console.log('wrote', name)
}

/**
 * Android launcher icons, written straight into the generated native project.
 *
 * `npx cap add android` seeds the project with Capacitor's own logo, and
 * regenerating from the same code as the web icons keeps the two in step
 * without adding an image toolchain. Adaptive icons want a 108dp canvas whose
 * central 72dp is guaranteed visible, which is exactly what the maskable
 * variant already draws, so the foreground layer reuses it.
 */
const ANDROID_RES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'android', 'app', 'src', 'main', 'res',
)
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }

if (process.argv.includes('--android')) {
  if (!fs.existsSync(ANDROID_RES)) {
    console.error('no android project yet -- run `npx cap add android` first')
    process.exit(1)
  }
  for (const [density, dpr] of Object.entries(DENSITIES)) {
    const dir = path.join(ANDROID_RES, `mipmap-${density}`)
    fs.mkdirSync(dir, { recursive: true })
    const legacy = Math.round(48 * dpr)
    const png = toPng(render(legacy), legacy)
    // The round variant is the same artwork: the plate is already a rounded
    // square that reads correctly once a launcher clips it to a circle.
    fs.writeFileSync(path.join(dir, 'ic_launcher.png'), png)
    fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), png)
    const fg = Math.round(108 * dpr)
    fs.writeFileSync(
      path.join(dir, 'ic_launcher_foreground.png'),
      toPng(render(fg, { maskable: true }), fg),
    )
    console.log('wrote android', density, `${legacy}px / ${fg}px`)
  }
}
