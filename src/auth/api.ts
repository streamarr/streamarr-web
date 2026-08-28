import { getJson, postJson, request } from '../api/http'

// The client always uses cookie mode: tokens live in httpOnly cookies, the body carries only
// the access-token expiry and the granted scope.

export { AuthApiError } from '../api/http'

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

export interface ServerStatus {
  setupComplete: boolean
  devicePairingEnabled: boolean
}

export function getSetupStatus(): Promise<ServerStatus> {
  return getJson<ServerStatus>('/api/auth/status')
}

// Signing in is itself a cookie-mode request: a stale streamarr_access cookie or the CSRF marker
// still rides along, and the server's matcher covers unsafe requests carrying either. Without the
// echo, the action that would replace the stale state is the one action refused.
export function login(input: LoginInput): Promise<AuthTokens> {
  return postJson('/api/auth/login', { ...input, cookieMode: true })
}

export function setup(input: SetupInput): Promise<AuthTokens> {
  return postJson('/api/auth/setup', { ...input, cookieMode: true })
}

// The select ceremonies infer cookie mode from how the request authenticated, so the body
// carries only the choice — and for a protected Profile, the PIN the server verifies and
// throttles itself (ADR 0024: PINs never ride GraphQL).
export function selectHousehold(householdId: string): Promise<AuthTokens> {
  return postJson('/api/auth/select-household', { householdId })
}

export function selectProfile(profileId: string, pin?: string): Promise<AuthTokens> {
  return postJson('/api/auth/select-profile', pin ? { profileId, pin } : { profileId })
}

export async function logout(): Promise<void> {
  await request('/api/auth/refresh/revoke', { method: 'POST' })
}
