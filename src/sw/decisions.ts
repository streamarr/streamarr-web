// Pure decision logic for the service worker, imported by sw.ts and unit-tested here.
// The worker is best-effort by design (ADR 0016): correctness never rests on it, so these
// functions decide narrowly and default to passing requests through untouched.

export type InterceptDecision = 'intercept' | 'pass-through'

/**
 * Intercept same-origin /graphql and /api/** fetches, EXCEPT the worker's own refresh call
 * (recursion) and /api/stream/** (playback URLs carry their own ?t= token; hls.js requests
 * must pass through untouched).
 */
export function decideIntercept(requestUrl: string | URL, pageOrigin: string): InterceptDecision {
  const url = new URL(requestUrl, pageOrigin)
  if (url.origin !== pageOrigin) {
    return 'pass-through'
  }
  if (url.pathname === '/api/auth/refresh' || url.pathname.startsWith('/api/stream/')) {
    return 'pass-through'
  }
  if (url.pathname === '/graphql' || url.pathname.startsWith('/api/')) {
    return 'intercept'
  }
  return 'pass-through'
}

/** The refresh-and-retry signal: a 401 whose body carries code EXPIRED_TOKEN. */
export function isExpiredTokenResponse(status: number, body: unknown): boolean {
  if (status !== 401 || typeof body !== 'object' || body === null) {
    return false
  }
  return (body as { code?: unknown }).code === 'EXPIRED_TOKEN'
}

/**
 * Collapses concurrent invocations onto one in-flight operation. One SW instance serves every
 * tab of the origin, so a module-scoped instance of this IS the cross-tab refresh lock.
 */
export class SingleFlight<T> {
  private inFlight: Promise<T> | null = null

  run(operation: () => Promise<T>): Promise<T> {
    this.inFlight ??= operation().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }
}
