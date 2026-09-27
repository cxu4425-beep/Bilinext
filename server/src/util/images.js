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
 */
export const viaProxy = (url, kind = 'media', variant = '') =>
  url ? `/api/proxy/${kind}?url=${encodeURIComponent(sized(url, variant))}` : url
