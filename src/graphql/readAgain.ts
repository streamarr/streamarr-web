import type {
  ApolloClient,
  DocumentNode,
  ObservableQuery,
  OperationVariables,
} from '@apollo/client'
import { isForbidden } from './errorRouting'

// A read beside a query leaves the query's own status alone, so the reads in flight are counted
// here for callers that must wait for them.
const readsInFlight = new WeakMap<object, { count: number }>()

function readsOf(query: object): { count: number } {
  let reads = readsInFlight.get(query)
  if (!reads) {
    reads = { count: 0 }
    readsInFlight.set(query, reads)
  }
  return reads
}

/**
 * Reads every active query again beside the screens that watch it, and settles once every read
 * has. A fresh answer reaches each screen through the cache. A failed read leaves each screen on
 * its last result, because only a query's own refetch puts its error in front of its screen. A
 * query that already failed reads through its own refetch. A forbidden answer is a refusal
 * rather than an interruption, so that query reads again through its screen to show the refusal.
 * The error link already routes the other refusals.
 */
export function readActiveQueriesAgain(client: ApolloClient): Promise<unknown> {
  return readEachAgain(client, client.getObservableQueries('active'))
}

/** Reads the queries of `documents` again the way `readActiveQueriesAgain` reads every query. */
export function readQueriesAgain(
  client: ApolloClient,
  documents: DocumentNode[],
): Promise<unknown> {
  return readEachAgain(client, client.getObservableQueries(documents))
}

function readEachAgain(client: ApolloClient, queries: Set<ObservableQuery>): Promise<unknown> {
  return Promise.allSettled([...queries].map((query) => readAgain(client, query)))
}

// Whether `readActiveQueriesAgain` or `readQueriesAgain` is reading `query` now.
function isReadingAgain(query: object): boolean {
  return readsOf(query).count > 0
}

/** Whether `query` has a read in flight, its own or one beside it. A refetch would join that read. */
export function isReading<TData, TVariables extends OperationVariables>(
  query: ObservableQuery<TData, TVariables>,
): boolean {
  return query.getCurrentResult().loading || isReadingAgain(query)
}

/**
 * Refetches `query` with a read sent after every read of it now in flight. The answer to a read in
 * flight can be from before a change the caller has just made, and a refetch would join that read,
 * so this refetch waits for its answer and then reads again.
 */
export async function refetchAfterReadsInFlight<TData, TVariables extends OperationVariables>(
  query: ObservableQuery<TData, TVariables>,
): Promise<unknown> {
  if (isReading(query)) await query.refetch().catch(() => undefined)
  return query.refetch()
}

async function readAgain(client: ApolloClient, query: ObservableQuery): Promise<unknown> {
  const reads = readsOf(query)
  reads.count += 1
  try {
    return await readKeepingTheLastResult(client, query)
  } finally {
    reads.count -= 1
  }
}

async function readKeepingTheLastResult(
  client: ApolloClient,
  query: ObservableQuery,
): Promise<unknown> {
  // A screen that already shows its failure has nothing to keep, and an answer equal to the
  // cache would never reach it through the cache.
  if (query.getCurrentResult().error) return query.refetch()
  try {
    return await client.query({
      query: query.query,
      variables: query.variables,
      // A live list's context takes this read through the changes that arrive on its way.
      context: query.options.context,
      fetchPolicy: 'network-only',
    })
  } catch (error) {
    if (isForbidden(error)) return query.refetch()
    throw error
  }
}
