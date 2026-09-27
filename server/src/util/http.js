import { Agent, interceptors, setGlobalDispatcher } from 'undici'

/**
 * undici 7 removed per-request `maxRedirections`; redirects are now an
 * interceptor on the dispatcher. Media responses are large and slow, so the
 * body timeout is disabled -- a 4K stream must not be cut off mid-seek.
 */
setGlobalDispatcher(
  new Agent({
    connect: { timeout: 15_000 },
    headersTimeout: 30_000,
    bodyTimeout: 0,
    keepAliveTimeout: 30_000,
  }).compose(interceptors.redirect({ maxRedirections: 5 })),
)
