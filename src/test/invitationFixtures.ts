import type { InvitationPreview } from '../auth/api'

/** What looking up a working invitation code answers: an invitation to create an Account. */
export function invitationPreviewFixture(
  overrides: Partial<InvitationPreview> = {},
): InvitationPreview {
  return {
    recipientEmail: 'kai@example.com',
    householdName: 'Smith Family',
    householdRole: 'MEMBER',
    mode: 'CREATE',
    profileName: 'Kai',
    profileKind: 'ADULT',
    maximumAllowedRatingAge: null,
    expiresAt: '2026-08-27T12:00:00Z',
    remainingManagers: [],
    householdsLosingProfileAccess: [],
    profileShareOfferTargets: [],
    ...overrides,
  }
}
