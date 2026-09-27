import './util/http.js'
import fs from 'node:fs'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { HOST, PORT, WEB_DIST } from './config.js'
import { BiliError } from './bili/client.js'
import authRoutes from './routes/auth.js'
import contentRoutes from './routes/content.js'
import interactRoutes from './routes/interact.js'
import meRoutes from './routes/me.js'
import publishRoutes from './routes/publish.js'
import proxyRoutes from './routes/proxy.js'

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  bodyLimit: 32 * 1024 * 1024,
})

await app.register(cors, {
  // The dev web server and the packaged shells are the only expected callers.
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)
    const ok =
      /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin) ||
      /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin) ||
      /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/.test(origin) ||
      origin === 'capacitor://localhost' ||
      origin === 'http://localhost' ||
      origin === 'tauri://localhost'
    cb(null, ok)
  },
  credentials: true,
  allowedHeaders: ['content-type', 'x-bili-client'],
})

await app.register(multipart, {
  limits: { fileSize: 8 * 1024 * 1024 * 1024, files: 1 },
})

/**
 * Every state-changing call must carry this header. A browser cannot attach a
 * custom header cross-origin without passing preflight, so this stops any other
 * page you happen to have open from driving your bilibili account through the
 * local server.
 */
app.addHook('onRequest', async (req, reply) => {
  const writing = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS'
  if (writing && req.url.startsWith('/api/') && req.headers['x-bili-client'] !== 'bili-next') {
    reply.code(403).send({ error: 'missing client header' })
  }
})

app.setErrorHandler((err, req, reply) => {
  if (err instanceof BiliError) {
    req.log.warn({ code: err.code, path: req.url }, err.message)
    const status = err.needsLogin ? 401 : err.riskControlled ? 429 : 400
    return reply.code(status).send({
      error: err.message,
      code: err.code,
      needsLogin: err.needsLogin,
      riskControlled: err.riskControlled,
    })
  }
  req.log.error(err)
  return reply.code(err.statusCode || 500).send({ error: err.message })
})

for (const route of [
  authRoutes,
  contentRoutes,
  interactRoutes,
  meRoutes,
  publishRoutes,
  proxyRoutes,
]) {
  await app.register(route)
}

app.get('/api/health', async () => ({ ok: true, version: '0.1.0' }))

// Serve the built PWA when it exists, so `npm start` is the whole production
// story; in dev, Vite serves the front end and proxies /api back here.
if (fs.existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' })
    return reply.sendFile('index.html')
  })
}

/**
 * A port clash is the most likely startup failure -- double-clicking the start
 * script twice is easy to do -- and an unhandled listen() rejection dumps a
 * Node stack trace, which tells a non-developer nothing useful.
 */
try {
  await app.listen({ port: PORT, host: HOST })
  app.log.info(`bili-next listening on http://localhost:${PORT}`)
} catch (err) {
  // Deliberately ASCII: a bare cmd.exe console is not UTF-8 unless something
  // ran `chcp 65001` first, and a garbled message is worse than an English one.
  const say = (line = '') => console.error(line)
  if (err.code === 'EADDRINUSE') {
    say()
    say(`  Port ${PORT} is already in use, so BiliNext did not start.`)
    say(`  Most likely it is already running - just open http://localhost:${PORT}`)
    say(`  To use a different port:   set PORT=8788 && npm start`)
    say()
    process.exit(1)
  }
  if (err.code === 'EACCES') {
    say()
    say(`  Not allowed to bind port ${PORT}. Pick a port above 1024.`)
    say()
    process.exit(1)
  }
  throw err
}
