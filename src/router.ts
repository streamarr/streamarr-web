import { createRouter, type RouterHistory } from '@tanstack/react-router'
import { resumeSearchFor } from './auth/resume'
import { createApolloClient } from './graphql/client'
import { routeTree } from './routeTree.gen'

/**
 * The router and the Apollo client are one composition: the error link's auth routing IS a
 * navigation, so neither can be built without the other. `history` is only passed by tests,
 * which drive a memory history instead of the address bar.
 */
export function createAppRouter(history?: RouterHistory) {
  const router = createRouter({ routeTree, history })
  const apolloClient = createApolloClient((route) => {
    if (route === '/select') {
      router.navigate({ to: route })
      return
    }
    // Signing in can resume where the 401 happened, so the bounce carries the way back.
    router.navigate({ to: route, search: resumeSearchFor(router.state.location.pathname) })
  })
  return { router, apolloClient }
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>['router']
  }
}
