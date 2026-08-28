import type { ApolloClient } from '@apollo/client'
import { decideAuthRoute, extractAuthContext } from '../graphql/errorRouting'
import { MeDocument } from '../graphql/generated/graphql'

// Only the server can say whether live session cookies exist (they are httpOnly); this caches
// its one answer for the route guards and lets the auth flows overwrite it when they know better.

export type SessionAnswer = 'authenticated' | 'anonymous'

export interface SessionStore {
  /** Resolve the session state, probing the server once if it has never answered. */
  ensure(): Promise<SessionAnswer>
  /** The cached answer only — never probes; null until the server has answered once. */
  peek(): SessionAnswer | null
  markAuthenticated(): void
  markAnonymous(): void
}

export function createSessionStore(probe: () => Promise<SessionAnswer>): SessionStore {
  let known: SessionAnswer | null = null
  let inFlight: Promise<SessionAnswer> | null = null

  return {
    ensure() {
      if (known) {
        return Promise.resolve(known)
      }
      // An indeterminate probe (rejection) leaves nothing cached, so the next ensure retries.
      inFlight ??= probe()
        .then((answer) => (known = answer))
        .finally(() => {
          inFlight = null
        })
      return inFlight
    },
    peek() {
      return known
    },
    markAuthenticated() {
      known = 'authenticated'
    },
    markAnonymous() {
      known = 'anonymous'
    },
  }
}

/**
 * Opts out of the error link's routing: a 401 here is the answer "anonymous", not an eviction,
 * and the calling guard owns the navigation. Anything unclassifiable rejects — an outage is not
 * a verdict.
 */
export function probeSession(client: ApolloClient): Promise<SessionAnswer> {
  return client
    .query({ query: MeDocument, context: { skipAuthRouting: true } })
    .then(() => 'authenticated', answerFromRejection)
}

function answerFromRejection(error: unknown): SessionAnswer {
  const context = extractAuthContext(error)
  // Escaped every renewal layer: on arrival that is "anonymous".
  if (context.networkStatus === 401 && context.networkCode === 'EXPIRED_TOKEN') {
    return 'anonymous'
  }
  const route = decideAuthRoute(context)
  if (route === '/login') {
    return 'anonymous'
  }
  // A real session missing only a scope upgrade.
  if (route === '/select-profile') {
    return 'authenticated'
  }
  throw error
}
