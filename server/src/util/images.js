import { ACCESS_KEY } from '../config.js'
import { currentToken } from './ctx.js'

/**
 * hdslb serves resized, re-encoded derivatives through an `@`-suffix on the
 * path. Asking for the original is not merely wasteful -- a bilibili "face" can
 * be a 2048x2048 装扮 illustration of several megabytes, which renders as
 * garbage once squeezed into a 32px circle. Requesting a centre-cropped square
 * instead fixes the framing and cuts the transfer by three orders of magnitude.
 */
export const IMG = {
  avatar: '@96w_96h_1c.webp',
  cover: '@672w_378h_1c.webp',
  folder: '@320w_180h_1c.webp',
}

function sized(url, variant) {
  if (!variant || !/(^|\.)hdslb\.com\//.test(url)) return url
  // Drop any derivative bilibili already appended before adding our own.
  return url.replace(/@[^/]*$/, '') + variant
}

/**
 * Rewrites a bilibili CDN url so the browser fetches it through our proxy,
 * which is the only party able to send the Referer their edge requires.
 *
 * When an access key is configured it is baked into the query string. Images
 * and video are loaded by `<img>` and `<video>`, which cannot be given a
 * header -- so for these URLs the key has to travel in the URL itself. That
 * means it shows up in the browser's network log and in the page markup, which
 * is the accepted trade-off for media; everything that can set a header sends
 * it as one instead.
 */
export const viaProxy = (url, kind = 'media', variant = '') => {
  if (!url) return url
  const q = `url=${encodeURIComponent(sized(url, variant))}`
  // The caller's own credential, so each person's media URLs carry their own
  // session rather than a shared secret.
  const token = currentToken() || ACCESS_KEY
  return `/api/proxy/${kind}?${q}${token ? `&k=${encodeURIComponent(token)}` : ''}`
}
