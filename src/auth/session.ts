import type { ApolloClient } from '@apollo/client'
import { decideAuthRoute, extractAuthContext } from '../graphql/errorRouting'
import { MeDocument } from '../graphql/generated/graphql'

// Whether the browser holds live session cookies is a fact only the server can state — the
// client cannot read the httpOnly cookies, and after a hard reload its own auth state is empty.
// This store caches the server's one authoritative answer so route guards can gate on it, and
// lets the auth flows overwrite it the moment they know better (sign-in, sign-out, eviction).

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
 * Asks the server who the visitor is via the me query. The operation opts out of the error
 * link's auth routing: a 401 here is the answer "anonymous", not a mid-session eviction, and the
 * guard that called this owns the resulting navigation. A PROFILE_REQUIRED answer means the
 * session is real and only a scope upgrade is missing — authenticated, as far as gating goes.
 * An EXPIRED_TOKEN that reaches the probe escaped every renewal layer, so on arrival it is also
 * the answer "anonymous" — only the error link treats it as renewal's business. Anything else
 * (server down, 500) rejects: the caller must not mistake an outage for a verdict.
 */
export function probeSession(client: ApolloClient): Promise<SessionAnswer> {
  return client.query({ query: MeDocument, context: { skipAuthRouting: true } }).then(
    () => 'authenticated',
    (error) => {
      const context = extractAuthContext(error)
      if (context.networkStatus === 401 && context.networkCode === 'EXPIRED_TOKEN') {
        return 'anonymous'
      }
      switch (decideAuthRoute(context)) {
        case '/login':
          return 'anonymous'
        case '/select-profile':
          return 'authenticated'
        default:
          throw error
      }
    },
  )
}
