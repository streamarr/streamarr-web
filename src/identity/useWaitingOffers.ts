import type { WatchQueryFetchPolicy } from '@apollo/client'
import { useQuery } from '@apollo/client/react'
import { ShareOffersDocument, type ShareOffersQuery } from '../graphql/generated/graphql'
import { useLiveList } from '../graphql/liveList'
import {
  keepsInHouseholdShares,
  shareIdOf,
  statusAt,
  withShareChange,
  type ShareChange,
} from './shareLists'
import { useNow } from './useNow'
import { useShareChanges } from './useShareChanges'

type ListedOffer = ShareOffersQuery['householdShares']['edges'][number]['node']
type OfferedProfile = NonNullable<ListedOffer['profile']>
/** An offer as the page lists it: one whose Profile the server names. */
export type PendingOffer = ListedOffer & { profile: OfferedProfile }

/**
 * The offers of Profiles to a Household that wait for its decision, read from the offers
 * themselves and kept current as shares change elsewhere. An offer leaves when its time runs out,
 * as the query would leave it out. `skip` reads nothing and follows nothing.
 */
export function useWaitingOffers(
  { householdId, serverAdmin }: { householdId: string; serverAdmin: boolean },
  { fetchPolicy, skip = false }: { fetchPolicy?: WatchQueryFetchPolicy; skip?: boolean } = {},
) {
  const variables = { householdId }
  // The offers that the query asks for.
  const list = { householdId, statuses: ['PENDING'] as const, serverAdmin }
  const liveOffers = useLiveList({
    query: ShareOffersDocument,
    variables,
    keyOf: shareIdOf,
    apply: (data, change: ShareChange) => {
      const edges = withShareChange(data.householdShares.edges, change, (share) =>
        keepsInHouseholdShares(share, list, new Date()),
      )
      return { ...data, householdShares: { ...data.householdShares, edges } }
    },
  })
  useShareChanges(liveOffers.receive, { skip })
  const query = useQuery(ShareOffersDocument, {
    variables,
    fetchPolicy,
    context: liveOffers.context,
    skip,
  })
  const listed = query.data?.householdShares.edges.map((edge) => edge.node) ?? []
  const now = useNow(listed.map((offer) => offer.expiresAt))
  const offers = listed
    .filter((offer) => statusAt(offer, now) === 'PENDING')
    .filter(namesItsProfile)
  return { query, offers }
}

function namesItsProfile(offer: ListedOffer): offer is PendingOffer {
  return offer.profile !== null
}
