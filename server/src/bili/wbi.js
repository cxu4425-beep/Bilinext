import crypto from 'node:crypto'

/**
 * Bilibili signs most read endpoints with "WBI": two rotating key halves are
 * published in the nav response, shuffled through this fixed permutation into a
 * 32-char mixin key, and md5'd together with the sorted query string. Requests
 * without a valid w_rid get -403.
 */
const MIXIN_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
]

const keyFromUrl = (url) => (url ? url.slice(url.lastIndexOf('/') + 1).split('.')[0] : '')

export function mixinKey(imgUrl, subUrl) {
  const raw = keyFromUrl(imgUrl) + keyFromUrl(subUrl)
  return MIXIN_TABLE.map((i) => raw[i]).join('').slice(0, 32)
}

/** Returns a new params object carrying wts + w_rid. */
export function signParams(params, mixin) {
  const wts = Math.floor(Date.now() / 1000)
  const merged = { ...params, wts }
  const query = Object.keys(merged)
    .sort()
    .map((k) => {
      // Bilibili strips these characters from values before hashing; keeping
      // them would make our signature disagree with the server's.
      const v = String(merged[k]).replace(/[!'()*]/g, '')
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
    })
    .join('&')
  const w_rid = crypto.createHash('md5').update(query + mixin).digest('hex')
  return { ...merged, w_rid }
}

/** Caches the mixin key; the underlying keys rotate roughly daily. */
export function createWbi(fetchNav) {
  let cached = { key: null, at: 0 }
  return async function getMixin(force = false) {
    const stale = Date.now() - cached.at > 30 * 60 * 1000
    if (!force && cached.key && !stale) return cached.key
    const nav = await fetchNav()
    const img = nav?.wbi_img?.img_url
    const sub = nav?.wbi_img?.sub_url
    if (!img || !sub) throw new Error('could not read wbi keys from nav')
    cached = { key: mixinKey(img, sub), at: Date.now() }
    return cached.key
  }
}
