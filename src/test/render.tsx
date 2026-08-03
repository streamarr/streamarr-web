import type { ApolloClient } from '@apollo/client'
import { ApolloProvider } from '@apollo/client/react'
import { MantineProvider } from '@mantine/core'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { createApolloClient } from '../graphql/client'
import { createAppRouter } from '../router'

type Rendered = RenderResult & { user: ReturnType<typeof userEvent.setup> }

/**
 * Renders under the app's providers (Apollo + Mantine + AuthProvider) with a fresh Apollo client
 * per render so its cache never leaks between tests. GraphQL requests hit /graphql, where MSW's
 * graphql handlers intercept them.
 */
export function renderWithProviders(ui: ReactElement): Rendered {
  return renderUnderProviders(createApolloClient(vi.fn()), ui)
}

/**
 * Renders the whole app at a starting path — the real route tree and the real error-link-to-
 * navigation wiring — so route-level behavior (guards, redirects, search params) is exercised
 * as it ships. The returned router is the assertion surface: its location says where a visitor
 * landed.
 */
export function renderAppAt(path: string): Rendered & {
  router: ReturnType<typeof createAppRouter>['router']
} {
  const { router, apolloClient } = createAppRouter(createMemoryHistory({ initialEntries: [path] }))
  return { ...renderUnderProviders(apolloClient, <RouterProvider router={router} />), router }
}

function renderUnderProviders(client: ApolloClient, ui: ReactElement): Rendered {
  const user = userEvent.setup()
  const result = render(
    <ApolloProvider client={client}>
      <MantineProvider defaultColorScheme="dark">
        <AuthProvider>{ui}</AuthProvider>
      </MantineProvider>
    </ApolloProvider>,
  )
  return { ...result, user }
}
