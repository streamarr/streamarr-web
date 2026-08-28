import { getJson, postJson, request } from '../api/http'

export { AuthApiError } from '../api/http'

// Cookie mode: the tokens live in httpOnly cookies; the body carries only expiry and scope.
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

// A stale access cookie or CSRF marker rides along with sign-in, and the server's CSRF matcher
// covers unsafe requests carrying either — so sign-in must echo the token like any other call.
export function login(input: LoginInput): Promise<AuthTokens> {
  return postJson('/api/auth/login', { ...input, cookieMode: true })
}

export function setup(input: SetupInput): Promise<AuthTokens> {
  return postJson('/api/auth/setup', { ...input, cookieMode: true })
}

// The select ceremonies infer cookie mode from the request itself; a Profile PIN rides REST
// only, never GraphQL.
export function selectHousehold(householdId: string): Promise<AuthTokens> {
  return postJson('/api/auth/select-household', { householdId })
}

export function selectProfile(profileId: string, pin?: string): Promise<AuthTokens> {
  return postJson('/api/auth/select-profile', pin ? { profileId, pin } : { profileId })
}

export async function logout(): Promise<void> {
  await request('/api/auth/refresh/revoke', { method: 'POST' })
}

export interface InvitationPreview {
  recipientEmail: string
  householdName: string
  householdRole: string
  mode: 'CREATE' | 'CONNECT'
  profileName: string
  profileKind: 'ADULT' | 'KID'
  maximumAllowedRatingAge: number | null
  expiresAt: string
  remainingManagers: string[]
  endingHouseholds: string[]
  reofferHouseholds: string[]
}

export interface AcceptInvitationInput {
  code: string
  displayName: string
  password: string
}

// Invitation ceremonies authenticate by code alone; every miss answers 404 INVALID_CODE, with
// unknown, expired, and decided codes deliberately indistinguishable.
export function lookupInvitation(code: string): Promise<InvitationPreview> {
  return postJson('/api/auth/invitation/lookup', { code })
}

export function acceptInvitation(input: AcceptInvitationInput): Promise<AuthTokens> {
  return postJson('/api/auth/invitation/accept', { ...input, cookieMode: true })
}

export async function declineInvitation(code: string): Promise<void> {
  await request('/api/auth/invitation/decline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
}

// Redemption deliberately creates no session: the person signs in fresh.
export async function redeemPasswordReset(code: string, newPassword: string): Promise<void> {
  await request('/api/auth/password-reset/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, newPassword }),
  })
}
