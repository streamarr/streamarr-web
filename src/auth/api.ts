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

export function login(input: LoginInput): Promise<AuthTokens> {
  return postJson('/api/auth/login', { ...input, cookieMode: true })
}

export function setup(input: SetupInput): Promise<AuthTokens> {
  return postJson('/api/auth/setup', { ...input, cookieMode: true })
}

export function selectHousehold(householdId: string): Promise<AuthTokens> {
  return postJson('/api/auth/select-household', { householdId, cookieMode: true }, { csrf: true })
}

export function selectProfile(profileId: string): Promise<AuthTokens> {
  return postJson('/api/auth/select-profile', { profileId, cookieMode: true }, { csrf: true })
}

export async function logout(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST', csrf: true })
}
