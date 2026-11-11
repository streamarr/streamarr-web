import { useApolloClient } from '@apollo/client/react'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useEffectEvent } from 'react'
import { ProfileShareChangedDocument } from '../graphql/generated/graphql'
import { responsePathHasError } from '../graphql/responseErrors'
import type { ShareChange } from './shareLists'

/**
 * Hands each committed change to a Profile share that the session may read to `onChange` while
 * the calling component is mounted. A page calls it before it queries its list of shares: it
 * subscribes first, and the active queries read again once its subscribe frame is on the socket,
 * so the list misses no change that committed between its read and the subscription.
 *
 * A change whose share arrives with errors is no change to apply, not even a removal: the
 * transport reports it missed, and the active queries read again. A refusal or a normal end stops
 * the changes; the page keeps what it last read and reads again on its next visit.
 */
export function useShareChanges(onChange: (change: ShareChange) => void) {
  const client = useApolloClient()
  // The router's own context, which a page reaches before its route has matched.
  const { subscriptions } = useRouter().options.context
  const apply = useEffectEvent(onChange)

  useEffect(() => {
    let stopped = false
    // Each page applies the change to its own list, so no cache write of Apollo's comes first.
    const subscription = client
      .subscribe({
        query: ProfileShareChangedDocument,
        fetchPolicy: 'no-cache',
        errorPolicy: 'all',
      })
      .subscribe(({ data, error }) => {
        const change = data?.profileShareChanged
        if (stopped || !change) return
        if (responsePathHasError(error, ['profileShareChanged', 'share'])) return
        apply(change)
      })
    // An open socket reports nothing for a new operation on its own.
    subscriptions.reportMissedChangesOnceSubscribed()
    return () => {
      stopped = true
      // A remount that subscribes before this task runs joins the same operation.
      setTimeout(() => subscription.unsubscribe())
    }
  }, [client, subscriptions])
}
