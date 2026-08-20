import { postJson } from '../api/http'

// Device pairing approval. Contract: streamarr-server docs/device-pairing-contract.adoc and the
// fixtures under docs/contracts/device-pairing/v1.

export type PairingStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'CONSUMED'

export type PairingDecision = 'APPROVE' | 'DENY'

export interface EligibleHousehold {
  id: string
  name: string
}

export interface PairingRequest {
  userCode: string
  deviceName: string
  status: PairingStatus
  requestedAt: string
  /** Every Household the approver may bind this TV to (ADR 0024: one TV, one Household). */
  households: EligibleHousehold[]
}

export interface PairingDecisionResult {
  status: PairingStatus
  deviceName: string
}

/** The user code rides in the body, never a path segment, so it stays out of access logs. */
export function lookupPairingRequest(
  userCode: string,
): Promise<PairingRequest> {
  return postJson('/api/auth/device/authorizations/lookup', { userCode })
}

// Approval binds the TV to one chosen Household; denial names none.
export function decidePairingRequest(
  userCode: string,
  decision: PairingDecision,
  householdId?: string,
): Promise<PairingDecisionResult> {
  return postJson('/api/auth/device/authorizations/decision', {
    userCode,
    decision,
    ...(householdId ? { householdId } : {}),
  })
}
