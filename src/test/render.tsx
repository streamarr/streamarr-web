import type { ApolloClient } from '@apollo/client'
import { ApolloProvider } from '@apollo/client/react'
import { MantineProvider } from '@mantine/core'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import {
  inactiveRenewalBridge,
  type RenewalBridge,
} from '../auth/renewalBridge'
import { createSessionStore, type SessionStore } from '../auth/session'
import { createApolloClient } from '../graphql/client'
import { createAppRouter } from '../router'
import { cssVariablesResolver, theme } from '../theme'

type Rendered = RenderResult & { user: ReturnType<typeof userEvent.setup> }

/**
 * Renders under the app's providers (Apollo + Mantine + AuthProvider) with a fresh Apollo client
 * per render so its cache never leaks between tests. GraphQL requests hit /graphql, where MSW's
 * graphql handlers intercept them. Component tests render no routes, so their session store must
 * never need the server's answer — a probe here is a bug, and it fails loudly.
 */
export function renderWithProviders(ui: ReactElement): Rendered {
  const session = createSessionStore(() =>
    Promise.reject(new Error('component tests must not probe the session')),
  )
  return renderUnderProviders(
    createApolloClient(vi.fn()),
    session,
    inactiveRenewalBridge,
    ui,
  )
}

/**
 * Renders the whole app at a starting path — the real route tree, guard, and error-link-to-
 * navigation wiring — so route-level behavior (guards, redirects, search params) is exercised
 * as it ships. The returned router is the assertion surface: its location says where a visitor
 * landed.
 */
export function renderAppAt(
  path: string,
  renewal: RenewalBridge = inactiveRenewalBridge,
): Rendered & {
  router: ReturnType<typeof createAppRouter>['router']
} {
  const { router, apolloClient, session } = createAppRouter(
    createMemoryHistory({ initialEntries: [path] }),
    renewal,
  )
  return {
    ...renderUnderProviders(
      apolloClient,
      session,
      renewal,
      <RouterProvider router={router} />,
    ),
    router,
  }
}

function renderUnderProviders(
  client: ApolloClient,
  session: SessionStore,
  renewal: RenewalBridge,
  ui: ReactElement,
): Rendered {
  const user = userEvent.setup()
  const result = render(
    <ApolloProvider client={client}>
      <MantineProvider defaultColorScheme="dark" theme={theme} cssVariablesResolver={cssVariablesResolver}>
        <AuthProvider sessionStore={session} renewal={renewal}>
          {ui}
        </AuthProvider>
      </MantineProvider>
    </ApolloProvider>,
  )
  return { ...result, user }
}
