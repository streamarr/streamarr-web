import { waitFor } from '@testing-library/react'
import { expect } from 'vitest'
import type { LiveShare } from '../identity/shareLists'
import type { serveGraphqlSocket } from './graphqlSocket'
import { HOUSEHOLD_ID, PROFILE_ID } from './meFixture'

type GraphqlSocket = ReturnType<typeof serveGraphqlSocket>

const WEEK = 7 * 24 * 60 * 60 * 1000

/** A week from now, so that an offer is still waiting for a decision whenever a test runs. */
export const IN_A_WEEK = new Date(Date.now() + WEEK).toISOString()

type LiveShareFixture = Omit<LiveShare, 'profile' | 'household'> & {
  __typename: 'ProfileShare'
  profile: (NonNullable<LiveShare['profile']> & { __typename: 'ProfileSummary' }) | null
  household: (NonNullable<LiveShare['household']> & { __typename: 'HouseholdSummary' }) | null
}

/** A share as a change carries it: every field that any list of shares reads. */
export function liveShare(overrides: Partial<LiveShareFixture> = {}): LiveShareFixture {
  return {
    __typename: 'ProfileShare',
    id: '77777777-7777-7777-7777-777777777777',
    profileId: PROFILE_ID,
    householdId: HOUSEHOLD_ID,
    status: 'PENDING',
    requiredByAccountMembership: false,
    expiresAt: IN_A_WEEK,
    endedAt: null,
    invalidationReason: null,
    profile: {
      __typename: 'ProfileSummary',
      id: PROFILE_ID,
      name: 'Alex',
      picture: null,
      kind: 'ADULT',
      personalProfile: false,
      restricted: false,
    },
    offeredByDisplayName: 'Sam',
    visitor: true,
    household: { __typename: 'HouseholdSummary', id: HOUSEHOLD_ID, name: 'Smith Family' },
    ...overrides,
  }
}

/** The fields that the target Household's admins no longer see once a share is over. */
export const HIDDEN_ONCE_OVER = {
  profile: null,
  visitor: null,
  offeredByDisplayName: null,
  household: null,
} satisfies Partial<LiveShareFixture>

/** The change the server sends for a share, or for a share that no longer exists. */
export function shareChanged(shareId: string, share: LiveShare | null) {
  return {
    data: { profileShareChanged: { __typename: 'ProfileShareChange', shareId, share } },
  }
}

/** Waits until the page follows share changes, so that a change published next reaches it. */
export async function followingShareChanges(socket: GraphqlSocket) {
  await waitFor(() => expect(socket.isLive('ProfileShareChanged')).toBe(true))
}
