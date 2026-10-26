import type { ApolloClient, ErrorLike, TypedDocumentNode } from '@apollo/client'

/**
 * Runs a subscription document through the shared transport and applies each change it delivers
 * until the returned function runs. With errorPolicy 'all', a change whose field failed arrives
 * with its errors, and the operation keeps running: the change applies whatever data it carries,
 * a null field carries none, and the transport reports the change missed so the active queries
 * read again. A result without data ends the operation and reaches `onStop`.
 */
export function watchLiveChanges<TData>(
  client: ApolloClient,
  query: TypedDocumentNode<TData, Record<string, never>>,
  { apply, onStop }: { apply: (data: TData) => void; onStop: (error: ErrorLike) => void },
): () => void {
  let stopped = false
  const subscription = client
    .subscribe({ query, errorPolicy: 'all' })
    .subscribe(({ data, error }) => {
      if (stopped) return
      if (data) {
        apply(data)
        return
      }
      if (error) onStop(error)
    })
  // A remount that subscribes before this task runs joins the same operation, as useSubscription's
  // does, instead of ending it and starting another.
  return () => {
    stopped = true
    setTimeout(() => subscription.unsubscribe())
  }
}
