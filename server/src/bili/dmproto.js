/**
 * Decoder for bilibili's segmented danmaku stream (DmSegMobileReply).
 *
 * The legacy XML endpoint (list.so) is a capped sample: it declares a
 * <maxlimit> of a few hundred and returns roughly that many however busy the
 * video is. The protobuf segments are what the official client reads and they
 * carry every visible danmaku -- on a 2:24 video XML returned 600, the
 * segments 4,823.
 *
 * These messages only use varint and length-delimited fields, so a general
 * protobuf library would be dead weight.
 */

function readVarint(buf, pos) {
  let result = 0n
  let shift = 0n
  let byte
  do {
    if (pos >= buf.length) throw new Error('truncated varint')
    byte = buf[pos++]
    result |= BigInt(byte & 0x7f) << shift
    shift += 7n
  } while (byte & 0x80)
  return [result, pos]
}

function fields(buf) {
  const out = new Map()
  let pos = 0
  while (pos < buf.length) {
    let key
    ;[key, pos] = readVarint(buf, pos)
    const field = Number(key >> 3n)
    const wire = Number(key & 7n)
    let value
    if (wire === 0) {
      ;[value, pos] = readVarint(buf, pos)
    } else if (wire === 2) {
      let len
      ;[len, pos] = readVarint(buf, pos)
      const end = pos + Number(len)
      value = buf.subarray(pos, end)
      pos = end
    } else if (wire === 1) {
      value = buf.subarray(pos, pos + 8)
      pos += 8
    } else if (wire === 5) {
      value = buf.subarray(pos, pos + 4)
      pos += 4
    } else {
      throw new Error(`unsupported protobuf wire type ${wire}`)
    }
    if (!out.has(field)) out.set(field, [])
    out.get(field).push(value)
  }
  return out
}

const int = (f, n) => Number(f.get(n)?.[0] ?? 0n)
const str = (f, n) => f.get(n)?.[0]?.toString('utf8') ?? ''

/** Field numbers follow DanmakuElem in bilibili's dm.proto. */
export function decodeSegment(buf) {
  const top = fields(buf)
  return (top.get(1) || []).map((raw) => {
    const f = fields(raw)
    return {
      time: int(f, 2) / 1000, // progress, in ms
      mode: int(f, 3) || 1,
      size: int(f, 4) || 25,
      color: int(f, 5),
      text: str(f, 7),
      sentAt: int(f, 8),
      // bilibili's "smart block" score; kept so a density filter can use it.
      weight: int(f, 9),
      dmid: str(f, 12) || (f.get(1)?.[0]?.toString() ?? ''),
    }
  })
}

/**
 * The danmaku preferences bilibili syncs with the account, from
 * /x/v2/dm/web/view (DmWebViewReply field 10). Only fields verified one by one
 * against the official client's own saved settings are read: 11 opacity,
 * 12 display area (percent), 13 speed, 14 font size, 15 full-screen sync.
 * Absent booleans are false, as protobuf omits defaults.
 */
export function decodeViewSetting(buf) {
  const cfg = fields(buf).get(10)?.[0]
  if (!cfg) return null
  const f = fields(cfg)
  const f32 = (n) => {
    const b = f.get(n)?.[0]
    return b && b.length === 4 ? Math.round(b.readFloatLE(0) * 1000) / 1000 : undefined
  }
  return {
    opacity: f32(11),
    area: f.has(12) ? Number(f.get(12)[0]) / 100 : undefined,
    speed: f32(13),
    fontsize: f32(14),
    fullscreenSync: Number(f.get(15)?.[0] ?? 0n) === 1,
  }
}
