import type { ApolloClient } from '@apollo/client'
import { createRouter, type RouterHistory } from '@tanstack/react-router'
import { inactiveRenewalBridge, type RenewalBridge } from './auth/renewalBridge'
import { createSessionStore, probeSession } from './auth/session'
import { type AuthRoute, createApolloClient } from './graphql/client'
import { createSubscriptionTransport } from './graphql/subscriptionTransport'
import { routeTree } from './routeTree.gen'

/**
 * One composition: the guard probes over the client, and the error link's routing is a
 * navigation. `history` is passed only by tests.
 */
export function createAppRouter(
  history?: RouterHistory,
  renewal: Pick<RenewalBridge, 'refreshNow'> = inactiveRenewalBridge,
) {
  // The probe closes over the client assigned below: the only order the circular wiring allows.
  let apolloClient: ApolloClient
  const session = createSessionStore(async () => {
    const answer = await probeSession(apolloClient)
    if (answer === 'authenticated') {
      void renewal.refreshNow()
    }
    return answer
  })
  const subscriptions = createSubscriptionTransport({
    url: graphqlSocketUrl(window.location),
    renewal,
    onSignedOut: () => routeAuth('/login'),
  })
  // Back returns to where the reader was: the window on ambient pages and any scrolled panel.
  const router = createRouter({
    routeTree,
    history,
    context: { session, subscriptions },
    scrollRestoration: true,
  })
  const routeAuth = (route: AuthRoute): void => {
    if (route === '/select-profile') {
      void router.navigate({ to: route })
      return
    }
    // An eviction ends the socket with the session. Recording it stops the guard from waving a
    // back-navigation through on a stale answer, and the bounce carries the way back.
    subscriptions.stop()
    session.markAnonymous()
    void router.navigate({ to: route, search: { redirect: router.state.location.href } })
  }
  apolloClient = createApolloClient(routeAuth, subscriptions.link)
  return { router, apolloClient, session, subscriptions }
}

// Same origin as the page, so the handshake carries the session cookie.
function graphqlSocketUrl(location: Location): string {
  const url = new URL('/graphql', location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>['router']
  }
}
