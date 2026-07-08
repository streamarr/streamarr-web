import { readCsrfCookie } from './csrf'

// The client always uses cookie mode: tokens live in httpOnly cookies, the body carries only
// the access-token expiry and the granted scope. Same-origin by construction (Vite dev proxy in
// development, reverse proxy in production), so no CORS.

export interface AuthTokens {
  accessTokenExpiresAt: string
  scope: string
}

export interface LoginInput {
  email: string
  password: string
  deviceName?: string
}

export interface SetupInput {
  email: string
  displayName: string
  password: string
  householdName: string
  profileName: string
}

/** Carries the server's machine-readable error code so callers can route (e.g. TOO_MANY_ATTEMPTS). */
export class AuthApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`Auth request failed (${status}${code ? `: ${code}` : ''})`)
    this.name = 'AuthApiError'
  }
}

export async function getSetupStatus(): Promise<{ setupComplete: boolean }> {
  const response = await fetch('/api/auth/status', { credentials: 'same-origin' })
  return (await parse(response)) as { setupComplete: boolean }
}

export function login(input: LoginInput): Promise<AuthTokens> {
  return post('/api/auth/login', { ...input, cookieMode: true })
}

export function setup(input: SetupInput): Promise<AuthTokens> {
  return post('/api/auth/setup', { ...input, cookieMode: true })
}

export function selectHousehold(householdId: string): Promise<AuthTokens> {
  return post('/api/auth/select-household', { householdId, cookieMode: true }, { csrf: true })
}

export function selectProfile(profileId: string): Promise<AuthTokens> {
  return post('/api/auth/select-profile', { profileId, cookieMode: true }, { csrf: true })
}

export async function logout(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST', csrf: true })
}

async function post<T>(url: string, body: unknown, opts: { csrf?: boolean } = {}): Promise<T> {
  const response = await request(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    csrf: opts.csrf,
  })
  return (await parse(response)) as T
}

async function request(
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
  throw new AuthApiError(response.status, await readErrorCode(response))
}

async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.clone().json()) as { code?: unknown }
    return typeof body.code === 'string' ? body.code : null
  } catch {
    return null
  }
}
