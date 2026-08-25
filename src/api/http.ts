import { csrfHeaders, isCsrfRejection } from '../auth/csrf'

// Same-origin by construction (Vite dev proxy in development, reverse proxy in production), so
// no CORS. Cookies are the carrier; nothing here ever touches a token value.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE'])

/** The server's `{ code, message }` error body: route on `code`, show `serverMessage`. */
export class AuthApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    /** Seconds from a 429's Retry-After, so a throttled page can say how long, not just "later". */
    readonly retryAfterSeconds: number | null = null,
    /** The server's displayable sentence for this refusal, when the body carried one. */
    readonly serverMessage: string | null = null,
  ) {
    super(`Auth request failed (${status}${code ? `: ${code}` : ''})`)
    this.name = 'AuthApiError'
  }
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
  return (await parse(response)) as T
}

export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin' })
  return (await parse(response)) as T
}

export async function request(
  url: string,
  init: RequestInit,
): Promise<Response> {
  // A CSRF rejection may send this request twice. Callers must therefore supply a replayable body;
  // postJson serializes its body to a string, which is safe to reuse.
  const unsafe = !SAFE_METHODS.has(init.method?.toUpperCase() ?? 'GET')
  const send = () => {
    const headers = new Headers(init.headers)
    if (unsafe) {
      // Cookie-authenticated requests echo the current script-readable CSRF cookie.
      for (const [name, value] of Object.entries(csrfHeaders())) {
        headers.set(name, value)
      }
    }
    return fetch(url, { ...init, headers, credentials: 'same-origin' })
  }

  let response = await send()
  if (unsafe && isCsrfRejection(response.status, (await readErrorBody(response)).code)) {
    response = await send()
  }
  await throwIfError(response)
  return response
}

async function parse(response: Response): Promise<unknown> {
  await throwIfError(response)
  if (
    response.status === 204 ||
    response.headers.get('Content-Length') === '0'
  ) {
    return undefined
  }
  return response.json()
}

async function throwIfError(response: Response): Promise<void> {
  if (response.ok) {
    return
  }
  const { code, message } = await readErrorBody(response)
  throw new AuthApiError(response.status, code, readRetryAfterSeconds(response), message)
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

async function readErrorBody(
  response: Response,
): Promise<{ code: string | null; message: string | null }> {
  try {
    const body = (await response.clone().json()) as { code?: unknown; message?: unknown }
    return {
      code: typeof body.code === 'string' ? body.code : null,
      message: typeof body.message === 'string' && body.message.trim() ? body.message : null,
    }
  } catch {
    return { code: null, message: null }
  }
}
