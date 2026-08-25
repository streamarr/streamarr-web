import type { ApolloClient } from '@apollo/client'
import { createRouter, type RouterHistory } from '@tanstack/react-router'
import {
  inactiveRenewalBridge,
  type RenewalBridge,
} from './auth/renewalBridge'
import { createSessionStore, probeSession } from './auth/session'
import { createApolloClient } from './graphql/client'
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
  const router = createRouter({ routeTree, history, context: { session } })
  apolloClient = createApolloClient((route) => {
    if (route === '/select-profile') {
      router.navigate({ to: route })
      return
    }
    // An eviction: record it so the guard cannot wave a back-navigation through on a stale
    // answer, then bounce carrying the way back.
    session.markAnonymous()
    router.navigate({ to: route, search: { redirect: router.state.location.href } })
  })
  return { router, apolloClient, session }
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>['router']
  }
}
