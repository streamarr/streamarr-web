import type { ShareOffersQuery } from '../graphql/generated/graphql'
import { HOUSEHOLD_ID, PROFILE_ID } from './meFixture'
import { IN_A_WEEK } from './shareChangeFixtures'

type OfferFields = ShareOffersQuery['householdShares']['edges'][number]['node']
type OfferedProfile = NonNullable<OfferFields['profile']> & { __typename: 'ProfileSummary' }
export type OfferNode = Omit<OfferFields, 'profile'> & {
  __typename: 'ProfileShare'
  profile: OfferedProfile | null
}

export const OFFER_ID = '77777777-7777-7777-7777-777777777777'

export function offeredProfile(overrides: Partial<OfferedProfile> = {}): OfferedProfile {
  return {
    __typename: 'ProfileSummary',
    id: PROFILE_ID,
    name: 'Alex',
    picture: null,
    kind: 'ADULT',
    personalProfile: false,
    restricted: false,
    ...overrides,
  }
}

export function offer(overrides: Partial<OfferNode> = {}): OfferNode {
  return {
    __typename: 'ProfileShare',
    id: OFFER_ID,
    profileId: PROFILE_ID,
    householdId: HOUSEHOLD_ID,
    status: 'PENDING',
    // A week ahead, since the server lists an offer as waiting only before its expiry.
    expiresAt: IN_A_WEEK,
    profile: offeredProfile(),
    offeredByDisplayName: 'Sam',
    visitor: true,
    ...overrides,
  }
}

export function offersData(offers: OfferNode[]) {
  return {
    householdShares: {
      __typename: 'ProfileShareConnection',
      edges: offers.map((node) => ({ __typename: 'ProfileShareEdge', node })),
    },
  }
}
