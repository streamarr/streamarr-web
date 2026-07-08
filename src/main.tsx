import '@mantine/core/styles.css'

import { ApolloProvider } from '@apollo/client/react'
import { MantineProvider } from '@mantine/core'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './auth/AuthProvider'
import { postCsrfTokenToServiceWorker } from './auth/csrf'
import { createApolloClient } from './graphql/client'
import { routeTree } from './routeTree.gen'

const router = createRouter({ routeTree })
const apolloClient = createApolloClient((route) => router.navigate({ to: route }))

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

if ('serviceWorker' in navigator) {
  const swUrl = import.meta.env.DEV ? '/src/sw/sw.ts' : '/sw.js'
  navigator.serviceWorker
    .register(swUrl, { type: 'module' })
    .then(() => postCsrfTokenToServiceWorker())
    .catch(() => {
      // Best-effort: the app works without the worker; renewal falls back to login routing.
    })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="dark">
      <ApolloProvider client={apolloClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ApolloProvider>
    </MantineProvider>
  </StrictMode>,
)
