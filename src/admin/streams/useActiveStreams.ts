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
import { installRevalidation } from '../../graphql/revalidation'
import {
  type LiveStreamsStop,
  NO_ACTIVE_STREAMS_READ,
  reduceActiveStreams,
} from './activeStreamsList'

// A read that never answers would hold every later read after a gap behind it.
const READ_DEADLINE_MS = 15_000

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
  const readsOut = useRef(0)

  const readStreams = useCallback(async () => {
    reads.current += 1
    const read = reads.current
    dispatch({ kind: 'reading', read })
    readsOut.current += 1
    const abandon = new AbortController()
    const deadline = setTimeout(() => abandon.abort(), READ_DEADLINE_MS)
    try {
      // Each read asks afresh: one that joined a read still out would answer with a list from
      // before the changes that this read cleared.
      const { data } = await client.query({
        query: ActiveStreamsDocument,
        fetchPolicy: 'no-cache',
        context: { queryDeduplication: false, fetchOptions: { signal: abandon.signal } },
      })
      dispatch({ kind: 'read', read, streams: data?.activeStreams ?? [] })
    } catch (error) {
      dispatch({ kind: 'readFailed', read, failure: error as ErrorLike })
    } finally {
      clearTimeout(deadline)
      readsOut.current -= 1
    }
  }, [client])

  useEffect(() => {
    let stopped = false
    // A result that carries no change ends live changes only when the operation completes after
    // it; while the operation runs, its failed field is a missed change that the transport reports.
    let ending: LiveStreamsStop = 'failed'
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
          if (error) ending = isForbidden(error) ? 'forbidden' : 'failed'
        },
        complete: () => {
          if (!stopped) dispatch({ kind: 'stopped', stop: ending })
        },
      })
    // The list is no watched query, so it reads again by itself on each gap that the app's
    // queries read again on: missed changes, the network's return and the page's.
    const stopRevalidation = installRevalidation({
      refetchActive: readStreams,
      isReading: () => readsOut.current > 0,
      onMissedChanges: (listener) => subscriptions.onMissedChanges(listener),
      window,
      document,
    })
    void readStreams()
    // An open socket reports nothing for a new operation on its own; the read after its subscribe
    // frame covers the changes that committed before it.
    subscriptions.reportMissedChangesOnceSubscribed()
    return () => {
      stopped = true
      stopRevalidation()
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
