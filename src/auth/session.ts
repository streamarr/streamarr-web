import type { ApolloClient } from '@apollo/client'
import { decideAuthRoute, extractAuthContext } from '../graphql/errorRouting'
import { ME_QUERY } from '../graphql/operations'

// Whether the browser holds live session cookies is a fact only the server can state — the
// client cannot read the httpOnly cookies, and after a hard reload its own auth state is empty.
// This store caches the server's one authoritative answer so route guards can gate on it, and
// lets the auth flows overwrite it the moment they know better (sign-in, sign-out, eviction).

export type SessionAnswer = 'authenticated' | 'anonymous'

export interface SessionStore {
  /** Resolve the session state, probing the server once if it has never answered. */
  ensure(): Promise<SessionAnswer>
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
    markAuthenticated() {
      known = 'authenticated'
    },
    markAnonymous() {
      known = 'anonymous'
    },
  }
}

/**
 * Asks the server who the visitor is via the me query. The operation opts out of the error
 * link's auth routing: a 401 here is the answer "anonymous", not a mid-session eviction, and the
 * guard that called this owns the resulting navigation. A PROFILE_REQUIRED answer means the
 * session is real and only a scope upgrade is missing — authenticated, as far as gating goes.
 * Anything else (server down, 500) rejects: the caller must not mistake an outage for a verdict.
 */
export function probeSession(client: ApolloClient): Promise<SessionAnswer> {
  return client.query({ query: ME_QUERY, context: { skipAuthRouting: true } }).then(
    () => 'authenticated',
    (error) => {
      switch (decideAuthRoute(extractAuthContext(error))) {
        case '/login':
          return 'anonymous'
        case '/select':
          return 'authenticated'
        default:
          throw error
      }
    },
  )
}
