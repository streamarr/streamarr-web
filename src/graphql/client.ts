import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client'
import { from } from '@apollo/client/link'
import { SetContextLink } from '@apollo/client/link/context'
import { onError } from '@apollo/client/link/error'
import { csrfHeaders, isCsrfRejection } from '../auth/csrf'
import generatedIntrospection from './generated/possibleTypes.json'
import { decideAuthRoute, extractAuthContext } from './errorRouting'

export type AuthRoute = '/login' | '/select'

const CSRF_RETRY_ATTEMPTED = 'csrfRetryAttempted'

// No auth link: cookies and the service worker own the session, and the only header the client
// adds is the CSRF echo — a POST carrying the auth cookies is exactly what the server's CSRF
// matcher covers, so every operation must send it. The error link routes terminal or escaped
// auth failures — AUTHENTICATION_REQUIRED/INVALID_TOKEN → /login, and
// PROFILE_REQUIRED/HOUSEHOLD_REQUIRED → /select. A CSRF rejection retries once; forward() resumes
// at the downstream CSRF link, which re-reads the re-minted cookie before the HTTP link sends the
// operation. The session probe opts out of routing only: its 401 is an answer to "am I signed
// in?", not an eviction, and the guard that asked owns the navigation — but it still benefits from
// the CSRF retry like any other operation. Recoverable 401s rarely reach here because the SW
// refreshes and replays them once.
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
    link: from([errorLink, csrfLink, httpLink]),
    // Generated possibleTypes keep fragment matching correct across the schema's unions and
    // interfaces — a silent mismatch would drop fields, not fail loudly.
    cache: new InMemoryCache({ possibleTypes: generatedIntrospection.possibleTypes }),
  })
}
