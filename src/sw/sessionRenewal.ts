import { CSRF_HEADER } from '../auth/csrf'
import type { RenewalResult } from '../auth/renewalProtocol'
import {
  isExpiredTokenResponse,
  rememberCsrfToken as chooseCsrfToken,
  SingleFlight,
} from './decisions'

interface SessionRenewalDependencies {
  fetch: typeof fetch
  now: () => number
  onRenewed: (
    expiresAt: string,
    isCurrent: () => boolean,
  ) => void | Promise<void>
  origin?: string
}

export interface SessionRenewal {
  adoptExpiry(expiresAt: string): void
  clearSession(): void
  rememberCsrfToken(token: string | null): void
  refresh(): Promise<RenewalResult>
  fetch(request: Request): Promise<Response>
}

const RENEWAL_LEEWAY_MS = 30_000

export function createSessionRenewal({
  fetch: fetcher,
  now,
  onRenewed,
  origin = location.origin,
}: SessionRenewalDependencies): SessionRenewal {
  let csrfToken: string | null = null
  let expiresAtMs: number | null = null
  let refreshRejected = false
  let generation = 0
  const refreshFlight = new SingleFlight<RenewalResult>()

  const adoptExpiry = (expiresAt: string): void => {
    const candidate = new Date(expiresAt).getTime()
    if (!Number.isNaN(candidate)) {
      generation += 1
      expiresAtMs = candidate
      refreshRejected = false
    }
  }

  const rememberCsrfToken = (token: string | null): void => {
    csrfToken = chooseCsrfToken(csrfToken, token)
  }

  const refresh = (): Promise<RenewalResult> =>
    refreshFlight.run(async () => {
      if (refreshRejected) {
        return { kind: 'rejected' }
      }
      const refreshGeneration = generation
      try {
        const headers: HeadersInit = csrfToken ? { [CSRF_HEADER]: csrfToken } : {}
        const response = await fetcher(new URL('/api/auth/refresh', origin), {
          method: 'POST',
          headers,
          credentials: 'same-origin',
        })
        if (refreshGeneration !== generation) {
          return { kind: 'rejected' }
        }
        if (response.status === 401) {
          expiresAtMs = null
          refreshRejected = true
          return { kind: 'rejected' }
        }
        if (!response.ok) {
          return { kind: 'unavailable' }
        }
        const body = (await response.json()) as { accessTokenExpiresAt?: unknown }
        const expiresAt = body.accessTokenExpiresAt
        const parsedExpiresAtMs =
          typeof expiresAt === 'string'
            ? new Date(expiresAt).getTime()
            : Number.NaN
        if (
          typeof expiresAt !== 'string' ||
          Number.isNaN(parsedExpiresAtMs) ||
          parsedExpiresAtMs <= now()
        ) {
          return { kind: 'unavailable' }
        }
        expiresAtMs = parsedExpiresAtMs
        try {
          await onRenewed(
            expiresAt,
            () => refreshGeneration === generation && !refreshRejected,
          )
        } catch {
          // Metadata fan-out is best-effort; the cookie session was already renewed.
        }
        if (refreshGeneration !== generation) {
          return { kind: 'rejected' }
        }
        return { kind: 'renewed', expiresAt }
      } catch {
        return { kind: 'unavailable' }
      }
    })

  return {
    adoptExpiry,

    clearSession() {
      generation += 1
      expiresAtMs = null
      refreshRejected = true
    },

    rememberCsrfToken,

    refresh,

    async fetch(request) {
      rememberCsrfToken(request.headers.get(CSRF_HEADER))
      const replayable = request.clone()
      let preflightResult: RenewalResult | undefined
      if (expiresAtMs !== null && expiresAtMs - now() <= RENEWAL_LEEWAY_MS) {
        preflightResult = await refresh()
      }
      const response = await fetcher(request)
      if (!(await isExpired(response))) {
        return response
      }
      if (refreshRejected) {
        return response
      }
      if (preflightResult) {
        return preflightResult.kind === 'unavailable'
          ? refreshUnavailableResponse()
          : response
      }
      const result = await refresh()
      if (result.kind === 'renewed') {
        return fetcher(replayable)
      }
      if (result.kind === 'unavailable') {
        return refreshUnavailableResponse()
      }
      return response
    },
  }
}

function refreshUnavailableResponse(): Response {
  return Response.json(
    {
      code: 'SESSION_REFRESH_UNAVAILABLE',
      message: 'Your session could not be renewed. Try again.',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  )
}

async function isExpired(response: Response): Promise<boolean> {
  if (response.status !== 401) {
    return false
  }
  try {
    return isExpiredTokenResponse(response.status, await response.clone().json())
  } catch {
    return false
  }
}
