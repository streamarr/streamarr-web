import {
  ApolloLink,
  type ApolloCache,
  type OperationVariables,
  type TypedDocumentNode,
} from '@apollo/client'
import { useApolloClient } from '@apollo/client/react'
import { useEffect, useState } from 'react'
import { Observable } from 'rxjs'

type Data = Record<string, unknown>

/** What the live list link asks of a list each time one of its reads goes out. */
interface LiveListReads {
  sent(): { answered: (data: Data) => Data; settled: () => void }
}

declare module '@apollo/client' {
  interface DefaultContext {
    /** The live list whose changes every answer to this query takes before the cache keeps it. */
    liveList?: LiveListReads
  }
}

/**
 * Takes every read of a live list, its query's own and the reads beside it, through the list's
 * changes: each answer takes again the changes that arrived after its read went out, before the
 * cache keeps it. It sits next to the HTTP link, so a held or retried read counts from its send.
 */
export const liveListLink = new ApolloLink((operation, forward) => {
  const list = operation.getContext().liveList
  if (!list) return forward(operation)
  return new Observable((observer) => {
    const read = list.sent()
    const sent = forward(operation).subscribe({
      next: (result) =>
        observer.next(result.data ? { ...result, data: read.answered(result.data) } : result),
      error: (error: unknown) => observer.error(error),
      complete: () => observer.complete(),
    })
    return () => {
      sent.unsubscribe()
      read.settled()
    }
  })
})

/**
 * One list that live changes keep current. A change reaches what the cache holds at once. The
 * server answers a read with the list as it read it, which can be from before a change that has
 * since arrived, so each answer takes again every change that arrived after its read was sent.
 * Only the last change for a key is kept, since it carries that key's latest state, and a change
 * older than every read on its way is forgotten, since every later read is sent after it.
 */
function createLiveList<TData extends Data, TVariables extends OperationVariables, TChange>({
  cache,
  query,
  keyOf,
  following,
}: {
  cache: ApolloCache
  query: TypedDocumentNode<TData, TVariables>
  keyOf: (change: TChange) => string
  following: { variables: TVariables; apply: (data: TData, change: TChange) => TData }
}) {
  let current = following
  let arrivals = 0
  const latest = new Map<string, { arrival: number; change: TChange }>()
  /** The arrivals counted when each read on its way was sent. */
  const sentAfter = new Map<symbol, number>()

  function forget() {
    const oldest = Math.min(arrivals, ...sentAfter.values())
    for (const [key, kept] of latest) {
      if (kept.arrival <= oldest) latest.delete(key)
    }
  }

  const reads: LiveListReads = {
    sent() {
      const read = Symbol('read')
      const after = arrivals
      sentAfter.set(read, after)
      return {
        answered: (data) =>
          [...latest.values()]
            .filter((kept) => kept.arrival > after)
            .sort((a, b) => a.arrival - b.arrival)
            // The link hands over an answer to this list's own query.
            .reduce((answer, kept) => current.apply(answer, kept.change), data as TData),
        settled: () => {
          sentAfter.delete(read)
          forget()
        },
      }
    },
  }

  return {
    context: { liveList: reads },
    follow: (next: typeof following) => {
      current = next
    },
    receive: (change: TChange) => {
      arrivals += 1
      latest.set(keyOf(change), { arrival: arrivals, change })
      forget()
      cache.updateQuery({ query, variables: current.variables }, (data) =>
        data ? current.apply(data, change) : undefined,
      )
    },
  }
}

/**
 * A list that live changes keep current. `receive` applies a change to what the cache holds, and
 * keeps it for every read of the list on its way; the query that reads the list passes `context`,
 * so that its answers take those changes too. `apply` gives the list once a change applies to it.
 */
export function useLiveList<TData extends Data, TVariables extends OperationVariables, TChange>({
  query,
  variables,
  keyOf,
  apply,
}: {
  query: TypedDocumentNode<TData, TVariables>
  variables: TVariables
  keyOf: (change: TChange) => string
  apply: (data: TData, change: TChange) => TData
}): { context: { liveList: LiveListReads }; receive: (change: TChange) => void } {
  const { cache } = useApolloClient()
  const [list] = useState(() =>
    createLiveList({ cache, query, keyOf, following: { variables, apply } }),
  )
  useEffect(() => list.follow({ variables, apply }))
  return list
}
