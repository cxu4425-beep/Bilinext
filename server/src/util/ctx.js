import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Who the current request belongs to.
 *
 * With several people signed in to one server, "the account" can no longer be
 * a global: two requests being served at the same moment belong to different
 * people. Threading an account argument through every route and every call in
 * bili/api.js would touch hundreds of lines, so the identity rides along the
 * call stack instead and only the few places that actually read cookies look
 * at it.
 *
 * Fastify keeps the request going inside the hook's `done()` callback, so
 * running the continuation inside `requestCtx.run()` covers every later hook
 * and the handler itself.
 */
export const requestCtx = new AsyncLocalStorage()

/** The bilibili account this request acts as, or null for an anonymous one. */
export const currentMid = () => requestCtx.getStore()?.mid ?? null

/**
 * The credential this request arrived with -- a session token in multi-user
 * mode, the shared access key otherwise. Media URLs are built with it, because
 * `<img>` and `<video>` cannot send headers.
 */
export const currentToken = () => requestCtx.getStore()?.token ?? null

/** Runs `fn` as a given account; used where there is no request to inherit. */
export const withAccount = (mid, fn) =>
  requestCtx.run({ ...(requestCtx.getStore() || {}), mid: mid ? String(mid) : null }, fn)
