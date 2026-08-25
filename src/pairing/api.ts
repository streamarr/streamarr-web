import type { RequestBody, Response2xx, Schema } from '../api/contract'
import { postJson } from '../api/http'

// Device pairing approval. Contract: streamarr-server docs/device-pairing-contract.adoc and the
// fixtures under docs/contracts/device-pairing/v1.

type LookupRequest = RequestBody<'/api/auth/device/authorizations/lookup', 'post'>
type DecisionRequest = RequestBody<'/api/auth/device/authorizations/decision', 'post'>
type LookupResponse = Response2xx<'/api/auth/device/authorizations/lookup', 'post'>
type DecisionResponse = Response2xx<'/api/auth/device/authorizations/decision', 'post'>

// The document types `status` and `decision` as open strings and marks no response field
// required; the pairing contract closes both, and the client keeps that.
export type PairingStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'CONSUMED'

export type PairingDecision = 'APPROVE' | 'DENY'

export type EligibleHousehold = Required<Schema<'EligibleHousehold'>>

export interface PairingRequest extends Required<Omit<LookupResponse, 'status' | 'households'>> {
  status: PairingStatus
  /** Every Household the approver may bind this TV to (ADR 0024: one TV, one Household). */
  households: EligibleHousehold[]
}

export interface PairingDecisionResult extends Required<Omit<DecisionResponse, 'status'>> {
  status: PairingStatus
}

/** The user code rides in the body, never a path segment, so it stays out of access logs. */
export function lookupPairingRequest(userCode: string): Promise<PairingRequest> {
  return postJson<PairingRequest>('/api/auth/device/authorizations/lookup', {
    userCode,
  } satisfies LookupRequest)
}

export function decidePairingRequest(
  userCode: string,
  decision: PairingDecision,
  householdId?: string,
): Promise<PairingDecisionResult> {
  return postJson<PairingDecisionResult>('/api/auth/device/authorizations/decision', {
    userCode,
    decision,
    ...(householdId ? { householdId } : {}),
  } satisfies DecisionRequest)
}
