import { request } from 'undici'
import { BILI_HEADERS, MEDIA_HOST_ALLOWLIST } from '../config.js'

/** Only ever proxy bilibili's own CDNs -- an open relay would be a liability. */
function allowed(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
  return MEDIA_HOST_ALLOWLIST.some((re) => re.test(parsed.hostname))
}

export default async function proxyRoutes(app) {
  /**
   * Streams video/audio segments through with Range support intact. Seeking in
   * the player depends entirely on 206 responses being passed through
   * faithfully, so Range, Content-Range and Accept-Ranges are forwarded
   * verbatim and the body is piped rather than buffered.
   */
  app.get('/api/proxy/media', async (req, reply) => {
    const url = req.query.url
    if (!allowed(url)) return reply.code(400).send({ error: 'host not allowed' })

    const headers = { ...BILI_HEADERS }
    if (req.headers.range) headers.range = req.headers.range

    const upstream = await request(url, { headers })

    reply.code(upstream.statusCode)
    for (const key of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'last-modified',
      'etag',
    ]) {
      if (upstream.headers[key]) reply.header(key, upstream.headers[key])
    }
    // Media URLs carry a short-lived signature; caching past that just produces
    // 403s on replay, so keep it brief and private.
    reply.header('cache-control', 'private, max-age=300')
    return reply.send(upstream.body)
  })

  /** Avatars and thumbnails on i*.hdslb.com also check Referer. */
  app.get('/api/proxy/image', async (req, reply) => {
    const url = req.query.url
    if (!allowed(url)) return reply.code(400).send({ error: 'host not allowed' })

    const upstream = await request(url, { headers: BILI_HEADERS })
    reply.code(upstream.statusCode)
    if (upstream.headers['content-type']) reply.header('content-type', upstream.headers['content-type'])
    if (upstream.headers['content-length'])
      reply.header('content-length', upstream.headers['content-length'])
    reply.header('cache-control', 'public, max-age=86400')
    return reply.send(upstream.body)
  })
}
