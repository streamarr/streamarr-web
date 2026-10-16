import { useMutation } from '@apollo/client/react'
import {
  MarkUnwatchedDocument,
  MarkWatchedDocument,
  type MovieDetailDocument,
  type SeasonDetailDocument,
  type SeriesDetailDocument,
} from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { userErrorMessage, type UserErrorLike } from '../graphql/userErrors'
import { invalidateWatchedState } from './watchedState'

const FAILURE_MESSAGE = "Couldn't update the watched state."

type TitleDetailDocument =
  typeof MovieDetailDocument | typeof SeriesDetailDocument | typeof SeasonDetailDocument

// markWatched/markUnwatched take any item id; the server cascades a series or season to its
// episodes. The payload's item and its related items update the cache at once. The title's page
// then reads again, because a read sent before the mark can answer with the earlier watch state.
// That read is a request of its own: Apollo would otherwise let it share a read still in flight.
export function useWatchedToggle(id: string, titleDetail: TitleDetailDocument) {
  const readTitleAgain = [
    { query: titleDetail, variables: { id }, context: { queryDeduplication: false } },
  ]
  const [markWatched, watchedState] = useMutation(MarkWatchedDocument, {
    update: (cache, { data }) => {
      if (data?.markWatched?.item) invalidateWatchedState(cache)
    },
    refetchQueries: readTitleAgain,
  })
  const [markUnwatched, unwatchedState] = useMutation(MarkUnwatchedDocument, {
    update: (cache, { data }) => {
      if (data?.markUnwatched?.item) invalidateWatchedState(cache)
    },
    refetchQueries: readTitleAgain,
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
