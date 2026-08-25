import type { RequestBody, Response2xx, Schema } from '../api/contract'
import { getJson, postJson, request } from '../api/http'

export { AuthApiError } from '../api/http'

type LoginRequest = RequestBody<'/api/auth/login', 'post'>
type SetupRequest = RequestBody<'/api/auth/setup', 'post'>
type SelectHouseholdRequest = RequestBody<'/api/auth/select-household', 'post'>
type SelectProfileRequest = RequestBody<'/api/auth/select-profile', 'post'>
type AcceptInvitationRequest = RequestBody<'/api/auth/invitation/accept', 'post'>
type RedeemPasswordResetRequest = RequestBody<'/api/auth/password-reset/redeem', 'post'>
type InvitationCodeRequest = Schema<'InvitationCodeRequest'>
type InvitationLookup = Response2xx<'/api/auth/invitation/lookup', 'post'>

// The document marks no response field required; each alias keeps what the server honours.
// Cookie mode: the tokens live in httpOnly cookies; the body carries only expiry and scope.
export type AuthTokens = Required<
  Pick<Schema<'AuthTokensResponse'>, 'accessTokenExpiresAt' | 'scope'>
>

export type LoginInput = Omit<LoginRequest, 'cookieMode'>

export type SetupInput = Omit<SetupRequest, 'cookieMode'>

export type ServerStatus = Required<Response2xx<'/api/auth/status', 'get'>>

export function getSetupStatus(): Promise<ServerStatus> {
  return getJson<ServerStatus>('/api/auth/status')
}

// A stale access cookie or CSRF marker rides along with sign-in, and the server's CSRF matcher
// covers unsafe requests carrying either — so sign-in must echo the token like any other call.
export function login(input: LoginInput): Promise<AuthTokens> {
  return postJson<AuthTokens>('/api/auth/login', {
    ...input,
    cookieMode: true,
  } satisfies LoginRequest)
}

export function setup(input: SetupInput): Promise<AuthTokens> {
  return postJson<AuthTokens>('/api/auth/setup', {
    ...input,
    cookieMode: true,
  } satisfies SetupRequest)
}

// The select ceremonies infer cookie mode from the request itself; a Profile PIN rides REST
// only, never GraphQL.
export function selectHousehold(householdId: string): Promise<AuthTokens> {
  return postJson<AuthTokens>('/api/auth/select-household', {
    householdId,
  } satisfies SelectHouseholdRequest)
}

export function selectProfile(profileId: string, pin?: string): Promise<AuthTokens> {
  return postJson<AuthTokens>(
    '/api/auth/select-profile',
    (pin ? { profileId, pin } : { profileId }) satisfies SelectProfileRequest,
  )
}

export async function logout(): Promise<void> {
  await request('/api/auth/refresh/revoke', { method: 'POST' })
}

// maximumAllowedRatingAge is null for an ADULT Profile; the document does not yet say so.
export type InvitationPreview = Required<Omit<InvitationLookup, 'maximumAllowedRatingAge'>> & {
  maximumAllowedRatingAge: number | null
}

export type AcceptInvitationInput = Omit<AcceptInvitationRequest, 'cookieMode'>

// Invitation ceremonies authenticate by code alone; every miss answers 404 INVALID_CODE, with
// unknown, expired, and decided codes deliberately indistinguishable.
export function lookupInvitation(code: string): Promise<InvitationPreview> {
  return postJson<InvitationPreview>('/api/auth/invitation/lookup', {
    code,
  } satisfies InvitationCodeRequest)
}

export function acceptInvitation(input: AcceptInvitationInput): Promise<AuthTokens> {
  return postJson<AuthTokens>('/api/auth/invitation/accept', {
    ...input,
    cookieMode: true,
  } satisfies AcceptInvitationRequest)
}

export async function declineInvitation(code: string): Promise<void> {
  await request('/api/auth/invitation/decline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code } satisfies InvitationCodeRequest),
  })
}

// Redemption deliberately creates no session: the person signs in fresh.
export async function redeemPasswordReset(code: string, newPassword: string): Promise<void> {
  await request('/api/auth/password-reset/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, newPassword } satisfies RedeemPasswordResetRequest),
  })
}
