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
