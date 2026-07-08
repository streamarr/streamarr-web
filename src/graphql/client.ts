import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client'

// No auth link: cookies and the service worker own the session. EXPIRED_TOKEN 401s rarely
// reach Apollo (the worker refreshes and replays); the error link routing for
// AUTHENTICATION_REQUIRED / PROFILE_REQUIRED lands with the auth flows.
export const apolloClient = new ApolloClient({
  link: new HttpLink({ uri: '/graphql', credentials: 'same-origin' }),
  cache: new InMemoryCache(),
})
