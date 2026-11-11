import type { ErrorLike, TypedDocumentNode } from '@apollo/client'
import { useApolloClient } from '@apollo/client/react'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useEffectEvent } from 'react'

/** One delivery of a subscription: its data, and the errors that came with it. */
export interface LiveResult<TData> {
  data: TData | undefined
  error?: ErrorLike
}

/**
 * Hands each delivery of the subscription `document` to `onResult` while the calling component is
 * mounted. A page calls it before it queries what the changes apply to: it subscribes first, and
 * the active queries read again once its subscribe frame is on the socket, so the page misses no
 * change that committed between its read and the subscription. A refusal or a normal end stops the
 * changes; the page keeps what it last read and reads again on its next visit.
 */
export function useLiveChanges<TData>(
  document: TypedDocumentNode<TData, Record<string, never>>,
  onResult: (result: LiveResult<TData>) => void,
) {
  const client = useApolloClient()
  // The router's own context, which a page reaches before its route has matched.
  const { subscriptions } = useRouter().options.context
  const deliver = useEffectEvent(onResult)

  useEffect(() => {
    let stopped = false
    // Each page applies the change to its own list, so no cache write of Apollo's comes first.
    const subscription = client
      .subscribe({ query: document, fetchPolicy: 'no-cache', errorPolicy: 'all' })
      .subscribe(({ data, error }) => {
        if (stopped) return
        deliver({ data, error })
      })
    // An open socket reports nothing for a new operation on its own.
    subscriptions.reportMissedChangesOnceSubscribed()
    return () => {
      stopped = true
      // A remount that subscribes before this task runs joins the same operation.
      setTimeout(() => subscription.unsubscribe())
    }
  }, [client, subscriptions, document])
}
