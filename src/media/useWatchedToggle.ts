import type { DocumentNode } from '@apollo/client'
import { useMutation } from '@apollo/client/react'
import { MarkUnwatchedDocument, MarkWatchedDocument } from '../graphql/generated/graphql'

// markWatched/markUnwatched take any collectable id; the server cascades a series or season to
// its episodes. The detail query is refetched so the verb flips only once the server agrees.
export function useWatchedToggle(id: string, detailQuery: DocumentNode) {
  const [markWatched, watchedState] = useMutation(MarkWatchedDocument, {
    refetchQueries: [detailQuery],
    awaitRefetchQueries: true,
  })
  const [markUnwatched, unwatchedState] = useMutation(MarkUnwatchedDocument, {
    refetchQueries: [detailQuery],
    awaitRefetchQueries: true,
  })

  return {
    markWatched: () => markWatched({ variables: { id } }).catch(ignoreReportedFailure),
    markUnwatched: () => markUnwatched({ variables: { id } }).catch(ignoreReportedFailure),
    pending: watchedState.loading || unwatchedState.loading,
    failed: Boolean(watchedState.error || unwatchedState.error),
  }
}

// The hook surfaces the failure through `failed`; the rejected promise carries nothing more.
function ignoreReportedFailure() {}
