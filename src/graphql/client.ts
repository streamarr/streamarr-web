import { ApolloClient, ApolloLink, HttpLink, InMemoryCache } from '@apollo/client'
import { SetContextLink } from '@apollo/client/link/context'
import { ErrorLink } from '@apollo/client/link/error'
import { OperationTypeNode } from 'graphql'
import { map, Observable, type Subscription, throwError } from 'rxjs'
import { csrfHeaders, isCsrfRejection } from '../auth/csrf'
import generatedIntrospection from './generated/possibleTypes.json'
import { decideAuthRoute, extractAuthContext } from './errorRouting'

export type AuthRoute = '/login' | '/select-profile'

class ResponseSentBeforeStoreResetError extends Error {
  constructor() {
    super('The response belongs to the identity that was active before the store reset.')
    this.name = 'ResponseSentBeforeStoreResetError'
  }
}

// Every store reset follows an identity change. Apollo cancels in-flight queries on a reset but
// still writes an in-flight mutation's result, which would put the earlier identity's entities
// into the next identity's cache.
class ResetCountingCache extends InMemoryCache {
  resets = 0

  override reset(options?: Parameters<InMemoryCache['reset']>[0]) {
    this.resets += 1
    return super.reset(options)
  }
}

function discardResponsesSentBeforeStoreReset(cache: ResetCountingCache) {
  return new ApolloLink((operation, forward) => {
    const resetsWhenSent = cache.resets
    return forward(operation).pipe(
      map((result) => {
        if (cache.resets !== resetsWhenSent) throw new ResponseSentBeforeStoreResetError()
        return result
      }),
    )
  })
}

class OperationOfEarlierIdentityError extends Error {
  constructor() {
    super('The operation belongs to the identity that was active before the identity switch.')
    this.name = 'OperationOfEarlierIdentityError'
  }
}

/** One Household or Profile switch, from its request until its answer. */
export interface IdentitySwitch {
  /**
   * The server switched the identity, or may have: operations of the earlier identity are refused
   * from now on, and the store reset that follows opens the gate to the new one.
   */
  succeeded: () => void
  /** The identity did not change, so the operations held since the switch began go out now. */
  failed: () => void
}

interface HeldOperation {
  send: () => void
  refuse: () => void
}

const IDENTITY_GENERATION = 'identityGeneration'

// The browser installs the new identity's cookie when a switch's response arrives, before the
// client reads it, so an operation the earlier identity sends from the switch's start until the
// store reset could act as the new identity. Each operation keeps the identity generation it began
// under, and the gate admits it before every send, a CSRF retry included. While a switch is
// underway it holds operations until the answer: a failed switch sends them, and a successful one
// refuses them, and every later one until the reset.
class IdentitySwitchGate {
  private generation = 0
  private switchesUnderway = 0
  private awaitingReset = false
  private readonly held = new Set<HeldOperation>()

  readonly link = new ApolloLink((operation, forward) => {
    const began = operation.getContext()[IDENTITY_GENERATION] as number | undefined
    if (began === undefined) {
      operation.setContext({ [IDENTITY_GENERATION]: this.generation })
    }
    if (this.awaitingReset || (began !== undefined && began !== this.generation)) {
      return throwError(() => new OperationOfEarlierIdentityError())
    }
    if (this.switchesUnderway === 0) {
      return forward(operation)
    }
    return new Observable((observer) => {
      let sent: Subscription | undefined
      const entry: HeldOperation = {
        send: () => {
          sent = forward(operation).subscribe(observer)
        },
        refuse: () => observer.error(new OperationOfEarlierIdentityError()),
      }
      this.held.add(entry)
      return () => {
        this.held.delete(entry)
        sent?.unsubscribe()
      }
    })
  })

  begin(): IdentitySwitch {
    this.switchesUnderway += 1
    let settled = false
    const settle = (settleHeld: (entry: HeldOperation) => void) => {
      if (settled) return
      settled = true
      this.switchesUnderway -= 1
      if (this.switchesUnderway > 0 && !this.awaitingReset) return
      const entries = [...this.held]
      this.held.clear()
      entries.forEach(settleHeld)
    }
    return {
      succeeded: () => {
        this.generation += 1
        this.awaitingReset = true
        settle((entry) => entry.refuse())
      },
      failed: () => settle((entry) => (this.awaitingReset ? entry.refuse() : entry.send())),
    }
  }

  storeReset() {
    this.awaitingReset = false
  }
}

const gates = new WeakMap<ApolloClient, IdentitySwitchGate>()

/**
 * Starts a Household or Profile switch on a client from createApolloClient: its operations wait
 * for the switch's answer, and after a successful switch none goes out until the store resets.
 */
export function beginIdentitySwitch(client: ApolloClient): IdentitySwitch {
  const gate = gates.get(client)
  if (!gate) throw new Error('The client was not created by createApolloClient.')
  return gate.begin()
}

const CSRF_RETRY_ATTEMPTED = 'csrfRetryAttempted'

// No auth link: cookies and the service worker own the session; the CSRF echo is the only header
// the client adds. Subscriptions take the WebSocket link when one is given; everything else posts.
export function createApolloClient(
  onAuthRoute: (route: AuthRoute) => void,
  subscriptionLink?: ApolloLink,
): ApolloClient {
  const errorLink = new ErrorLink(({ error, operation, forward }) => {
    const context = extractAuthContext(error)
    if (
      isCsrfRejection(context.networkStatus, context.networkCode) &&
      operation.getContext()[CSRF_RETRY_ATTEMPTED] !== true
    ) {
      operation.setContext({ [CSRF_RETRY_ATTEMPTED]: true })
      return forward(operation)
    }

    // The session probe opts out of the navigation only; it still gets the CSRF retry.
    if (operation.getContext().skipAuthRouting) {
      return
    }

    const route = decideAuthRoute(context)
    if (route) {
      onAuthRoute(route)
    }
  })

  const csrfLink = new SetContextLink((prevContext) => ({
    headers: { ...(prevContext.headers as Record<string, string> | undefined), ...csrfHeaders() },
  }))

  const httpLink = new HttpLink({
    uri: '/graphql',
    credentials: 'same-origin',
  })

  // Generated possibleTypes keep fragment matching correct across unions; a mismatch drops
  // fields silently.
  const cache = new ResetCountingCache({
    possibleTypes: generatedIntrospection.possibleTypes,
    typePolicies: {
      // One Me per session, which screens read in parts: each part adds to it, never replaces it.
      Me: { merge: true },
      Library: {
        fields: {
          alphabetIndex: { merge: false },
          // One loaded window per ordering and filter, however many titles each page asked for.
          items: { keyArgs: ['sort', 'filter'] },
        },
      },
      // Neither type has an id, so each is stored inside its title. Merging keeps the fields one
      // query read when another query writes different ones.
      SelectedProfileState: { merge: true },
      WatchState: { merge: true },
    },
  })

  // Error link next: forward() on a CSRF rejection re-enters the CSRF link, which re-reads the
  // re-minted cookie before the HTTP link sends.
  const gate = new IdentitySwitchGate()
  // The gate comes first and again before the HTTP link, which a CSRF retry re-enters.
  const httpChain = ApolloLink.from([
    gate.link,
    discardResponsesSentBeforeStoreReset(cache),
    errorLink,
    csrfLink,
    gate.link,
    httpLink,
  ])
  const link = subscriptionLink
    ? ApolloLink.split(
        ({ operationType }) => operationType === OperationTypeNode.SUBSCRIPTION,
        subscriptionLink,
        httpChain,
      )
    : httpChain

  const client = new ApolloClient({
    link,
    cache,
    // A refetch loading notification clears its error while retaining old data. Keep a refused
    // screen on its last result until the server answers; loading new variables still emits.
    defaultOptions: { watchQuery: { notifyOnNetworkStatusChange: false } },
  })
  // Reset callbacks run after the store empties and before the refetches go out.
  const openGate = () => {
    gate.storeReset()
    return Promise.resolve()
  }
  client.onResetStore(openGate)
  client.onClearStore(openGate)
  gates.set(client, gate)
  return client
}
