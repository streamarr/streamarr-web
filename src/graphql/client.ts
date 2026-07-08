import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client'
import { from } from '@apollo/client/link'
import { onError } from '@apollo/client/link/error'
import { decideAuthRoute, extractAuthContext } from './errorRouting'

export type AuthRoute = '/login' | '/select'

// No auth link: cookies and the service worker own the session. The error link routes the two
// error classes the SW can't resolve — AUTHENTICATION_REQUIRED/INVALID_TOKEN → /login, and
// PROFILE_REQUIRED/HOUSEHOLD_REQUIRED → /select. EXPIRED_TOKEN 401s rarely reach here (the SW
// refreshes and replays them) and never redirect.
export function createApolloClient(onAuthRoute: (route: AuthRoute) => void): ApolloClient {
  const errorLink = onError(({ error }) => {
    const route = decideAuthRoute(extractAuthContext(error))
    if (route) {
      onAuthRoute(route)
    }
  })

  const httpLink = new HttpLink({ uri: '/graphql', credentials: 'same-origin' })

  return new ApolloClient({ link: from([errorLink, httpLink]), cache: new InMemoryCache() })
}
