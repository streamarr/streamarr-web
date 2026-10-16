import { ApolloLink } from '@apollo/client'
import { CombinedGraphQLErrors } from '@apollo/client/errors'
import { GraphQLWsLink } from '@apollo/client/link/subscriptions'
import type { GraphQLFormattedError } from 'graphql'
import { createClient, type Client } from 'graphql-ws'
import { Observable, type Observer, type Subscription } from 'rxjs'
import type { RenewalBridge } from '../auth/renewalBridge'

const FIRST_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000
const ACCESS_TOKEN_EXPIRED = 4100
const ABNORMAL_CLOSURE = 1006
const SERVER_FAILURE = 1011
// These end one operation, not the socket: the client subscribes again, then reads again.
const RESUBSCRIBE_CODES = new Set(['SUBSCRIPTION_OVERFLOW', 'AUTHORIZATION_UNAVAILABLE'])

/**
 * The WebSocket side of the GraphQL client. One lazy socket carries every subscription operation
 * and lives no longer than the identity that opened it.
 *
 * The socket opens when the first operation starts and closes when the last one ends. A consumer
 * attaches by running a subscription document through the shared Apollo client, for example with
 * `useSubscription`. Its operation lives as long as the component that runs it, and it moves to
 * each replacement socket without the consumer doing anything.
 */
export interface SubscriptionTransport {
  /** The terminating link for subscription operations. */
  readonly link: ApolloLink
  /** Closes the socket and ends every live operation, as signing out requires. */
  stop(): void
  /**
   * Closes the socket that carries the earlier identity's authority and resubscribes every live
   * operation on a new socket. Frames that the closed socket still delivers are dropped.
   */
  replaceSocket(): void
  /**
   * Calls the listener each time live operations may have missed changes: a socket has sent the
   * subscribe frames of the live operations, and a change committed before then reached no
   * operation; or an operation delivered a change with field errors, and the change arrived
   * without the data that failed. The listener reads again.
   */
  onMissedChanges(listener: () => void): () => void
}

interface SubscriptionTransportDependencies {
  url: string
  renewal: Pick<RenewalBridge, 'refreshNow'>
  onSignedOut: () => void
  webSocketImpl?: unknown
  random?: () => number
}

interface Connection {
  client: Client
  link: GraphQLWsLink
  acknowledged: boolean
  renewBeforeReconnect: boolean
  lastCloseCode: number | null
}

interface LiveOperation {
  start(): void
  detach(): void
  end(): void
}

type LinkObserver = Observer<ApolloLink.Result>

export function createSubscriptionTransport({
  url,
  renewal,
  onSignedOut,
  webSocketImpl,
  random = Math.random,
}: SubscriptionTransportDependencies): SubscriptionTransport {
  const operations = new Set<LiveOperation>()
  const awaitingResubscribe = new Set<LiveOperation>()
  const missedChangeListeners = new Set<() => void>()
  const pendingWakes = new Set<() => void>()
  let current: Connection | undefined
  let resubscribeTimer: ReturnType<typeof setTimeout> | undefined

  const retryDelay = (attempt: number): number => {
    const ceiling = Math.min(MAX_RETRY_DELAY_MS, FIRST_RETRY_DELAY_MS * 2 ** attempt)
    return ceiling / 2 + (random() * ceiling) / 2
  }

  // A retired connection's wait ends at once, so graphql-ws finds no operation left and stops.
  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer)
        pendingWakes.delete(wake)
        resolve()
      }
      const timer = setTimeout(wake, ms)
      pendingWakes.add(wake)
    })

  const notifyMissedChanges = (): void => {
    for (const listener of missedChangeListeners) listener()
  }

  const renewBeforeReconnecting = async (connection: Connection): Promise<void> => {
    if (connection !== current || !connection.renewBeforeReconnect) return
    connection.renewBeforeReconnect = false
    const result = await renewal.refreshNow()
    if (result.kind === 'rejected' && connection === current) {
      stop()
      onSignedOut()
    }
  }

  // graphql-ws sends each subscribe frame after the connect promise it awaits settles, and that
  // promise settles after the connected event; one task later every frame is on the socket.
  const notifyOnceSubscribed = (connection: Connection): void => {
    setTimeout(() => {
      if (connection === current) notifyMissedChanges()
    }, 0)
  }

  const onConnected = (connection: Connection): void => {
    connection.acknowledged = true
    if (connection === current) notifyOnceSubscribed(connection)
  }

  // graphql-ws hands the browser's CloseEvent through untyped.
  const onClosed = (connection: Connection, event: unknown): void => {
    const { code } = event as CloseEvent
    connection.lastCloseCode = code
    if (code === ACCESS_TOKEN_EXPIRED || (code === ABNORMAL_CLOSURE && !connection.acknowledged)) {
      connection.renewBeforeReconnect = true
    }
    connection.acknowledged = false
  }

  const openConnection = (): Connection => {
    const connection = {
      acknowledged: false,
      renewBeforeReconnect: false,
      lastCloseCode: null,
    } as Connection
    connection.client = createClient({
      url,
      webSocketImpl,
      lazy: true,
      retryAttempts: Infinity,
      retryWait: async (retries) => {
        await wait(retryDelay(retries))
        await renewBeforeReconnecting(connection)
      },
      // graphql-ws ends operations itself after 1011 and the client-defect codes 4400, 4401, 4409
      // and 4429 before it asks; every other close and every socket error deserves another try.
      shouldRetry: () => true,
      on: {
        connecting: () => {
          connection.acknowledged = false
        },
        connected: () => onConnected(connection),
        closed: (event) => onClosed(connection, event),
        // A browser reports a refused handshake as an error before the 1006 close.
        error: () => {
          if (!connection.acknowledged) connection.renewBeforeReconnect = true
        },
      },
    })
    connection.link = new GraphQLWsLink(connection.client)
    return connection
  }

  const resubscribeAwaiting = (): void => {
    resubscribeTimer = undefined
    const due = [...awaitingResubscribe]
    awaitingResubscribe.clear()
    if (due.length === 0) return
    const open = current?.acknowledged === true ? current : undefined
    for (const live of due) live.start()
    // A socket that is not open yet reports once it connects.
    if (open) notifyOnceSubscribed(open)
  }

  const resubscribeLater = (live: LiveOperation, delay: number): void => {
    awaitingResubscribe.add(live)
    if (resubscribeTimer !== undefined) return
    resubscribeTimer = setTimeout(resubscribeAwaiting, delay)
  }

  const retireConnection = (): void => {
    const retired = current
    current = undefined
    clearTimeout(resubscribeTimer)
    resubscribeTimer = undefined
    // Detaching fences the retired socket: a frame it still delivers reaches no operation.
    for (const live of operations) live.detach()
    for (const wake of pendingWakes) wake()
    if (retired) {
      void Promise.resolve(retired.client.dispose()).catch(() => {})
    }
  }

  const stop = (): void => {
    const ended = [...operations]
    retireConnection()
    operations.clear()
    awaitingResubscribe.clear()
    for (const live of ended) live.end()
  }

  const liveOperation = (
    operation: ApolloLink.Operation,
    observer: LinkObserver,
  ): LiveOperation => {
    let subscription: Subscription | undefined
    // Only a change delivered to this operation shows that it recovered.
    let resubscribeAttempts = 0
    const finish = (): void => {
      subscription = undefined
      operations.delete(live)
    }
    const live: LiveOperation = {
      start() {
        current ??= openConnection()
        const connection = current
        let resubscribeOnComplete = false
        subscription = connection.link.request(operation).subscribe({
          next: (result) => {
            if (hasErrorCode(result.errors, RESUBSCRIBE_CODES)) {
              resubscribeOnComplete = true
              return
            }
            resubscribeAttempts = 0
            observer.next(result)
            // A field error delivers its change without the data, and the operation keeps running.
            if (result.data != null && (result.errors?.length ?? 0) > 0) notifyMissedChanges()
          },
          error: (error: unknown) => {
            subscription = undefined
            if (shouldResubscribe(error, connection)) {
              resubscribeLater(live, retryDelay(resubscribeAttempts++))
              return
            }
            finish()
            observer.error(error)
          },
          complete: () => {
            subscription = undefined
            if (resubscribeOnComplete) {
              resubscribeLater(live, retryDelay(resubscribeAttempts++))
              return
            }
            finish()
            observer.complete()
          },
        })
      },
      detach() {
        subscription?.unsubscribe()
        subscription = undefined
      },
      end() {
        live.detach()
        observer.complete()
      },
    }
    return live
  }

  const link = new ApolloLink(
    (operation) =>
      new Observable<ApolloLink.Result>((observer) => {
        const live = liveOperation(operation, observer)
        operations.add(live)
        live.start()
        return () => {
          operations.delete(live)
          awaitingResubscribe.delete(live)
          live.detach()
        }
      }),
  )

  return {
    link,
    stop,
    replaceSocket() {
      awaitingResubscribe.clear()
      retireConnection()
      for (const live of operations) live.start()
    },
    onMissedChanges(listener) {
      missedChangeListeners.add(listener)
      return () => missedChangeListeners.delete(listener)
    },
  }
}

function shouldResubscribe(error: unknown, connection: Connection): boolean {
  if (CombinedGraphQLErrors.is(error)) return hasErrorCode(error.errors, RESUBSCRIBE_CODES)
  return connection.lastCloseCode === SERVER_FAILURE
}

function hasErrorCode(
  errors: readonly GraphQLFormattedError[] | undefined,
  codes: ReadonlySet<string>,
): boolean {
  return (
    errors?.some((error) => {
      const code = error.extensions?.code
      return typeof code === 'string' && codes.has(code)
    }) ?? false
  )
}
