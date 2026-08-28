export type InterceptDecision = 'intercept' | 'pass-through'

/**
 * Same-origin /graphql and /api/** only, minus the worker's own refresh calls (recursion) and
 * /api/stream/** (playback URLs carry their own ?t= token).
 */
export function decideIntercept(
  requestUrl: string | URL,
  pageOrigin: string,
): InterceptDecision {
  const url = new URL(requestUrl, pageOrigin)
  if (url.origin !== pageOrigin) {
    return 'pass-through'
  }
  if (
    url.pathname === '/api/auth/refresh' ||
    url.pathname === '/api/auth/refresh/revoke' ||
    url.pathname.startsWith('/api/stream/')
  ) {
    return 'pass-through'
  }
  if (url.pathname === '/graphql' || url.pathname.startsWith('/api/')) {
    return 'intercept'
  }
  return 'pass-through'
}

/** A 401 that may be repaired by renewing the cookie session and replaying once. */
export function isRecoverableAccessTokenResponse(status: number, body: unknown): boolean {
  if (status !== 401 || typeof body !== 'object' || body === null) {
    return false
  }
  const code = (body as { code?: unknown }).code
  return code === 'EXPIRED_TOKEN' || code === 'INVALID_TOKEN'
}

/** Prefer a token echoed by the page, allowing a restarted worker to rebuild its volatile cache. */
export function rememberCsrfToken(
  cachedToken: string | null,
  requestToken: string | null,
): string | null {
  return requestToken?.trim() ? requestToken : cachedToken
}

/** One SW instance serves every tab of the origin, so one of these is the cross-tab refresh lock. */
export class SingleFlight<T> {
  private inFlight: Promise<T> | null = null

  run(operation: () => Promise<T>): Promise<T> {
    this.inFlight ??= operation().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }
}
