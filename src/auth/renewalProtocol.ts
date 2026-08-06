export type RenewalResult =
  | { kind: 'renewed'; expiresAt: string }
  | { kind: 'rejected' }
  | { kind: 'unavailable' }

export function isRenewalResult(value: unknown): value is RenewalResult {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false
  }
  if (value.kind === 'renewed') {
    return 'expiresAt' in value && typeof value.expiresAt === 'string'
  }
  return value.kind === 'rejected' || value.kind === 'unavailable'
}
