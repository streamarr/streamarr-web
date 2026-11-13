import {
  ApolloLink,
  type ApolloCache,
  type DocumentNode,
  type OperationVariables,
  type TypedDocumentNode,
} from '@apollo/client'
import { useApolloClient } from '@apollo/client/react'
import { canonicalStringify } from '@apollo/client/utilities'
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

/** The changes that the reads of one list take again, whichever component received them. */
interface Journal {
  context: { liveList: LiveListReads }
  /** Keeps `change` under `key` for every read of the list on its way. */
  keep(key: string, change: (data: Data) => Data): void
}

/**
 * The server answers a read with the list as it read it, which can be from before a change that
 * has since arrived, so each answer takes again every change that arrived after its read was sent.
 * Only the last change for a key is kept, since it carries that key's latest state, and a change
 * older than every read on its way is forgotten, since every later read is sent after it.
 */
function createJournal(): Journal {
  let arrivals = 0
  const latest = new Map<string, { arrival: number; change: (data: Data) => Data }>()
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
            .reduce((answer, kept) => kept.change(answer), data),
        settled: () => {
          sentAfter.delete(read)
          forget()
        },
      }
    },
  }

  return {
    context: { liveList: reads },
    keep(key, change) {
      arrivals += 1
      latest.set(key, { arrival: arrivals, change })
      forget()
    },
  }
}

/**
 * Each list's journal, by cache, query and variables. Apollo joins a read to one already on its
 * way with the same query and variables, under the context of the read it joins, and that read
 * may have been sent by a component that has since unmounted. So every component that follows a
 * list keeps its changes in the one journal. A journal holds no change once no read is on its way.
 */
const journals = new WeakMap<ApolloCache, WeakMap<DocumentNode, Map<string, Journal>>>()

function journalOf(cache: ApolloCache, query: DocumentNode, variables: OperationVariables) {
  let byQuery = journals.get(cache)
  if (!byQuery) {
    byQuery = new WeakMap()
    journals.set(cache, byQuery)
  }
  let byVariables = byQuery.get(query)
  if (!byVariables) {
    byVariables = new Map()
    byQuery.set(query, byVariables)
  }
  const key = canonicalStringify(variables)
  let journal = byVariables.get(key)
  if (!journal) {
    journal = createJournal()
    byVariables.set(key, journal)
  }
  return journal
}

/**
 * A list that live changes keep current. `receive` applies a change to what the cache holds at
 * once, and keeps it for every read of the list on its way; the query that reads the list passes
 * `context`, so that its answers take those changes too. `apply` gives the list once a change
 * applies to it. A change reaches the cache only when the cache holds an answer, unless
 * `wholeAnswerFrom` gives the whole answer from the change alone, as for a query whose every
 * change carries all of it.
 */
export function useLiveList<TData extends Data, TVariables extends OperationVariables, TChange>({
  query,
  variables,
  keyOf,
  apply,
  wholeAnswerFrom,
}: {
  query: TypedDocumentNode<TData, TVariables>
  variables: TVariables
  keyOf: (change: TChange) => string
  apply: (data: TData, change: TChange) => TData
  wholeAnswerFrom?: (change: TChange) => TData
}): { context: { liveList: LiveListReads }; receive: (change: TChange) => void } {
  const { cache } = useApolloClient()
  const journal = journalOf(cache, query, variables)
  return {
    context: journal.context,
    receive: (change) => {
      // The link hands the journal only answers to this list's own query.
      journal.keep(keyOf(change), (data) => apply(data as TData, change))
      cache.updateQuery({ query, variables }, (data) =>
        data ? apply(data, change) : wholeAnswerFrom?.(change),
      )
    },
  }
}
