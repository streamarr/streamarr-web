import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client'
import { from } from '@apollo/client/link'
import { SetContextLink } from '@apollo/client/link/context'
import { onError } from '@apollo/client/link/error'
import { csrfHeaders, isCsrfRejection } from '../auth/csrf'
import generatedIntrospection from './generated/possibleTypes.json'
import { decideAuthRoute, extractAuthContext } from './errorRouting'

export type AuthRoute = '/login' | '/select-profile'

const CSRF_RETRY_ATTEMPTED = 'csrfRetryAttempted'

// No auth link: cookies and the service worker own the session; the CSRF echo is the only header
// the client adds.
export function createApolloClient(onAuthRoute: (route: AuthRoute) => void): ApolloClient {
  const errorLink = onError(({ error, operation, forward }) => {
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
    headers: { ...prevContext.headers, ...csrfHeaders() },
  }))

  const httpLink = new HttpLink({
    uri: '/graphql',
    credentials: 'same-origin',
  })

  return new ApolloClient({
    // Error link first: forward() on a CSRF rejection re-enters the CSRF link, which re-reads the
    // re-minted cookie before the HTTP link sends.
    link: from([errorLink, csrfLink, httpLink]),
    // Generated possibleTypes keep fragment matching correct across unions; a mismatch drops
    // fields silently.
    cache: new InMemoryCache({ possibleTypes: generatedIntrospection.possibleTypes }),
  })
}
