import type { ErrorLike } from '@apollo/client'
import { useApolloClient } from '@apollo/client/react'
import { useRouteContext } from '@tanstack/react-router'
import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  ActiveStreamsChangedDocument,
  ActiveStreamsDocument,
} from '../../graphql/generated/graphql'
import { isForbidden } from '../../graphql/errorRouting'
import { responsePathHasError } from '../../graphql/responseErrors'
import { NO_ACTIVE_STREAMS_READ, reduceActiveStreams } from './activeStreamsList'

/**
 * The streams that play on the server now, kept current by live changes (ADR 0042): the changes
 * subscribe first, then the list reads, and it reads again whenever changes may have been missed.
 * A change whose stream failed to resolve leaves the row as it was until that read answers.
 */
export function useActiveStreams() {
  const client = useApolloClient()
  const { subscriptions } = useRouteContext({ from: '__root__' })
  const [state, dispatch] = useReducer(reduceActiveStreams, NO_ACTIVE_STREAMS_READ)
  const reads = useRef(0)

  const readStreams = useCallback(async () => {
    reads.current += 1
    const read = reads.current
    dispatch({ kind: 'reading', read })
    try {
      const { data } = await client.query({ query: ActiveStreamsDocument, fetchPolicy: 'no-cache' })
      dispatch({ kind: 'read', read, streams: data?.activeStreams ?? [] })
    } catch (error) {
      dispatch({ kind: 'readFailed', read, failure: error as ErrorLike })
    }
  }, [client])

  useEffect(() => {
    let stopped = false
    const subscription = client
      .subscribe({
        query: ActiveStreamsChangedDocument,
        fetchPolicy: 'no-cache',
        errorPolicy: 'all',
      })
      .subscribe({
        next: ({ data, error }) => {
          if (stopped) return
          const change = data?.activeStreamsChanged
          if (change) {
            // The transport reports the failed field's change missed, so the list reads again.
            if (responsePathHasError(error, ['activeStreamsChanged', 'activeStream'])) return
            dispatch({
              kind: 'changed',
              playbackSessionId: change.playbackSessionId,
              stream: change.activeStream,
            })
            return
          }
          if (error)
            dispatch({ kind: 'stopped', stop: isForbidden(error) ? 'forbidden' : 'failed' })
        },
        complete: () => {
          if (!stopped) dispatch({ kind: 'stopped', stop: 'failed' })
        },
      })
    const stopMissedChanges = subscriptions.onMissedChanges(() => void readStreams())
    void readStreams()
    // An open socket reports nothing for a new operation on its own; the read after its subscribe
    // frame covers the changes that committed before it.
    subscriptions.reportMissedChangesOnceSubscribed()
    return () => {
      stopped = true
      stopMissedChanges()
      // A remount that subscribes before this task runs joins the same operation.
      setTimeout(() => subscription.unsubscribe())
    }
  }, [client, subscriptions, readStreams])

  return {
    streams: state.streams,
    failure: state.failure,
    liveStop: state.liveStop,
    retry: readStreams,
  }
}
