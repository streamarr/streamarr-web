import type { ObservableQuery } from '@apollo/client'
import { useApolloClient, useMutation } from '@apollo/client/react'
import { MarkUnwatchedDocument, MarkWatchedDocument } from '../graphql/generated/graphql'
import { readAgainAfterTheReadInFlight } from '../graphql/readAgain'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage, type UserErrorLike } from '../graphql/userErrors'
import { invalidateWatchedState } from './watchedState'

const FAILURE_MESSAGE = "Couldn't update the watched state."

// markWatched/markUnwatched take any item id; the server cascades a series or season to its
// episodes. The payload's item and its related items update the cache, so no query is refetched,
// except one still reading when a mark succeeds: that read may answer with the earlier watch
// state, so the query reads once more after it.
export function useWatchedToggle(id: string) {
  const client = useApolloClient()
  // Apollo waits for a promise that onQueryUpdated returns before the mark settles, so the reads
  // run on their own. Returning false would also keep the mark's cache write from the query.
  const readAgainAfterReadsFromBeforeTheMark = (query: ObservableQuery) => {
    void readAgainAfterTheReadInFlight(client, query)
  }
  const [markWatched, watchedState] = useMutation(MarkWatchedDocument, {
    update: (cache, { data }) => {
      if (data?.markWatched?.item) invalidateWatchedState(cache)
    },
    refetchQueries: ({ data }) => (data?.markWatched?.item ? 'active' : []),
    onQueryUpdated: readAgainAfterReadsFromBeforeTheMark,
  })
  const [markUnwatched, unwatchedState] = useMutation(MarkUnwatchedDocument, {
    update: (cache, { data }) => {
      if (data?.markUnwatched?.item) invalidateWatchedState(cache)
    },
    refetchQueries: ({ data }) => (data?.markUnwatched?.item ? 'active' : []),
    onQueryUpdated: readAgainAfterReadsFromBeforeTheMark,
  })

  return {
    markWatched: () =>
      markWatched({ variables: { input: { itemId: id } } }).catch(ignoreReportedFailure),
    markUnwatched: () =>
      markUnwatched({ variables: { input: { itemId: id } } }).catch(ignoreReportedFailure),
    pending: watchedState.loading || unwatchedState.loading,
    failure:
      failureMessage(watchedState.error, watchedState.data?.markWatched?.userErrors) ??
      failureMessage(unwatchedState.error, unwatchedState.data?.markUnwatched?.userErrors),
  }
}

function failureMessage(
  error: unknown,
  userErrors: readonly UserErrorLike[] | undefined,
): string | null {
  if (userErrors?.length) return userErrorMessage(userErrors[0])
  if (error) return requestFailureMessage(error, FAILURE_MESSAGE)
  return null
}

function ignoreReportedFailure() {
  // The hook surfaces the failure through `failure`; the rejected promise carries nothing more.
}
