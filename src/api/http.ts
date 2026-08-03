import { readCsrfCookie } from '../auth/csrf'

// Same-origin by construction (Vite dev proxy in development, reverse proxy in production), so
// no CORS. Cookies are the carrier; nothing here ever touches a token value.

/** Carries the server's machine-readable error code so callers can route (e.g. TOO_MANY_ATTEMPTS). */
export class AuthApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    /** Seconds from a 429's Retry-After, so a throttled page can say how long, not just "later". */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`Auth request failed (${status}${code ? `: ${code}` : ''})`)
    this.name = 'AuthApiError'
  }
}

export async function postJson<T>(
  url: string,
  body: unknown,
  opts: { csrf?: boolean } = {},
): Promise<T> {
  const response = await request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    csrf: opts.csrf,
  })
  return (await parse(response)) as T
}

export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin' })
  return (await parse(response)) as T
}

export async function request(
  url: string,
  init: RequestInit & { csrf?: boolean },
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.csrf) {
    // Cookie-authenticated POSTs require the CSRF token echoed from the script-readable cookie.
    const token = readCsrfCookie()
    if (token) {
      headers.set('X-XSRF-TOKEN', token)
    }
  }
  const response = await fetch(url, { ...init, headers, credentials: 'same-origin' })
  await throwIfError(response)
  return response
}

async function parse(response: Response): Promise<unknown> {
  await throwIfError(response)
  if (response.status === 204 || response.headers.get('Content-Length') === '0') {
    return undefined
  }
  return response.json()
}

async function throwIfError(response: Response): Promise<void> {
  if (response.ok) {
    return
  }
  throw new AuthApiError(
    response.status,
    await readErrorCode(response),
    readRetryAfterSeconds(response),
  )
}

function readRetryAfterSeconds(response: Response): number | null {
  const header = response.headers.get('Retry-After')
  if (!header) {
    return null
  }
  // Only the delta-seconds form is contracted; an HTTP-date would parse as NaN.
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.clone().json()) as { code?: unknown }
    return typeof body.code === 'string' ? body.code : null
  } catch {
    return null
  }
}
