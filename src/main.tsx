import '@mantine/core/styles.css'

import { ApolloProvider } from '@apollo/client/react'
import { MantineProvider } from '@mantine/core'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './auth/AuthProvider'
import { postCsrfTokenToServiceWorker } from './auth/csrf'
import { inactiveRenewalBridge } from './auth/renewalBridge'
import { createBrowserRenewalBridge } from './auth/renewalBrowser'
import { createAppRouter } from './router'
import { decideRegistration } from './sw/registration'

const renewal =
  'serviceWorker' in navigator
    ? createBrowserRenewalBridge()
    : inactiveRenewalBridge
const { router, apolloClient, session } = createAppRouter(undefined, renewal)

if ('serviceWorker' in navigator) {
  const { scriptUrl, options } = decideRegistration(import.meta.env.DEV)
  navigator.serviceWorker
    .register(scriptUrl, options)
    .then(() => postCsrfTokenToServiceWorker())
    .catch(() => {
      // Best-effort: the app works without the worker; renewal falls back to login routing.
    })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="dark">
      <ApolloProvider client={apolloClient}>
        <AuthProvider sessionStore={session} renewal={renewal}>
          <RouterProvider router={router} />
        </AuthProvider>
      </ApolloProvider>
    </MantineProvider>
  </StrictMode>,
)
