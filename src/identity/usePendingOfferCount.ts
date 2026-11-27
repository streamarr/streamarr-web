import { useQuery } from '@apollo/client/react'
import { useMemo } from 'react'
import {
  PendingOfferCountDocument,
  PendingOfferCountChangedDocument,
  type PendingOfferCountQuery,
} from '../graphql/generated/graphql'
import { useLiveList } from '../graphql/liveList'
import { responsePathHasError } from '../graphql/responseErrors'
import { useLiveChanges } from '../graphql/useLiveChanges'

/** The server's whole waiting-offer count, kept current even before the first read succeeds. */
export function usePendingOfferCount({
  householdId,
  skip,
}: {
  householdId: string
  skip: boolean
}): number {
  const variables = useMemo(() => ({ householdId }), [householdId])
  const live = useLiveList({
    query: PendingOfferCountDocument,
    variables,
    keyOf: () => 'pendingOfferCount',
    apply: (_data, count: number) => counted(count),
    wholeAnswerFrom: counted,
  })
  useLiveChanges(
    PendingOfferCountChangedDocument,
    ({ data, error }) => {
      if (responsePathHasError(error, ['profileShareChanged', 'pendingOfferCount'])) return
      const count = data?.profileShareChanged?.pendingOfferCount
      if (typeof count === 'number') live.receive(count)
    },
    { skip, variables },
  )
  const { data } = useQuery(PendingOfferCountDocument, {
    variables,
    skip,
    context: live.context,
    fetchPolicy: 'cache-and-network',
  })
  return skip ? 0 : (data?.householdAdministration?.pendingOfferCount ?? 0)
}

function counted(pendingOfferCount: number): PendingOfferCountQuery {
  return { householdAdministration: { __typename: 'HouseholdAdministration', pendingOfferCount } }
}
