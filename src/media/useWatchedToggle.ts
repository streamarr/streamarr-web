import type { DocumentNode } from '@apollo/client'
import { useMutation } from '@apollo/client/react'
import { MarkUnwatchedDocument, MarkWatchedDocument } from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { invalidateWatchedState } from './watchedState'

const FAILURE_MESSAGE = "Couldn't update the watched state."

// markWatched/markUnwatched take any collectable id; the server cascades a series or season to
// its episodes. The detail query is refetched so the verb flips only once the server agrees.
export function useWatchedToggle(id: string, detailQuery: DocumentNode) {
  const [markWatched, watchedState] = useMutation(MarkWatchedDocument, {
    update: (cache, { data }) => {
      if (data?.markWatched?.userErrors.length === 0) invalidateWatchedState(cache)
    },
    onQueryUpdated: (query) => query.refetch(),
    refetchQueries: [detailQuery],
    awaitRefetchQueries: true,
  })
  const [markUnwatched, unwatchedState] = useMutation(MarkUnwatchedDocument, {
    update: (cache, { data }) => {
      if (data?.markUnwatched?.userErrors.length === 0) invalidateWatchedState(cache)
    },
    onQueryUpdated: (query) => query.refetch(),
    refetchQueries: [detailQuery],
    awaitRefetchQueries: true,
  })

  const error = watchedState.error ?? unwatchedState.error
  return {
    markWatched: () =>
      markWatched({ variables: { input: { itemId: id } } }).catch(ignoreReportedFailure),
    markUnwatched: () =>
      markUnwatched({ variables: { input: { itemId: id } } }).catch(ignoreReportedFailure),
    pending: watchedState.loading || unwatchedState.loading,
    failure: failureMessage(
      error,
      Boolean(
        watchedState.data?.markWatched?.userErrors.length ||
        unwatchedState.data?.markUnwatched?.userErrors.length,
      ),
    ),
  }
}

function failureMessage(error: unknown, refused: boolean): string | null {
  if (error) return requestFailureMessage(error, FAILURE_MESSAGE)
  if (refused) return FAILURE_MESSAGE
  return null
}

function ignoreReportedFailure() {
  // The hook surfaces the failure through `failure`; the rejected promise carries nothing more.
}
