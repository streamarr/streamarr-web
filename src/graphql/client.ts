import { ApolloClient, ApolloLink, HttpLink, InMemoryCache } from '@apollo/client'
import { SetContextLink } from '@apollo/client/link/context'
import { ErrorLink } from '@apollo/client/link/error'
import { map } from 'rxjs'
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

const CSRF_RETRY_ATTEMPTED = 'csrfRetryAttempted'

// No auth link: cookies and the service worker own the session; the CSRF echo is the only header
// the client adds.
export function createApolloClient(onAuthRoute: (route: AuthRoute) => void): ApolloClient {
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
  const cache = new ResetCountingCache({ possibleTypes: generatedIntrospection.possibleTypes })

  return new ApolloClient({
    // Error link next: forward() on a CSRF rejection re-enters the CSRF link, which re-reads the
    // re-minted cookie before the HTTP link sends.
    link: ApolloLink.from([
      discardResponsesSentBeforeStoreReset(cache),
      errorLink,
      csrfLink,
      httpLink,
    ]),
    cache,
  })
}
