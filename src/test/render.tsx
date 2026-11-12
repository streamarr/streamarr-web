import type { ApolloClient } from '@apollo/client'
import { ApolloProvider } from '@apollo/client/react'
import { MantineProvider } from '@mantine/core'
import { createMemoryHistory, RouterContextProvider, RouterProvider } from '@tanstack/react-router'
import { render, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { onTestFinished, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { inactiveRenewalBridge, type RenewalBridge } from '../auth/renewalBridge'
import { createSessionStore, type SessionStore } from '../auth/session'
import { createApolloClient } from '../graphql/client'
import type { SubscriptionTransport } from '../graphql/subscriptionTransport'
import { createAppRouter } from '../router'
import type { DecodingAnswers } from '../streaming/decodingAnswers'
import { cssVariablesResolver, theme } from '../theme'

type Rendered = RenderResult & { user: ReturnType<typeof userEvent.setup> }
type AppRouter = ReturnType<typeof createAppRouter>['router']

// Mounts a component on its own. The real route tree is provided as context only, so a
// component's <Link>s resolve without any route rendering.
export function renderWithProviders(ui: ReactElement): Rendered {
  const session = createSessionStore(() =>
    Promise.reject(new Error('component tests must not probe the session')),
  )
  const { router, subscriptions } = createAppRouter(createMemoryHistory({ initialEntries: ['/'] }))
  return renderUnderProviders({
    client: createApolloClient(vi.fn(), subscriptions.link),
    session,
    renewal: inactiveRenewalBridge,
    subscriptions,
    ui: <RouterContextProvider router={router}>{ui}</RouterContextProvider>,
  })
}

export function renderAppAt(
  path: string,
  renewal: RenewalBridge = inactiveRenewalBridge,
  decodingAnswers?: DecodingAnswers,
): Rendered & Pick<ReturnType<typeof createAppRouter>, 'router' | 'apolloClient'> {
  const { router, apolloClient, session, subscriptions } = createAppRouter(
    createMemoryHistory({ initialEntries: [path] }),
    renewal,
    decodingAnswers,
  )
  onTestFinished(({ task }) => {
    if (task.result?.state === 'pass') {
      requireFinishedNavigation(router)
    }
  })
  return {
    ...renderUnderProviders({
      client: apolloClient,
      session,
      renewal,
      subscriptions,
      ui: <RouterProvider router={router} />,
    }),
    router,
    apolloClient,
  }
}

// A router still loading when its test ends commits later, into a React tree that is gone. Once
// jsdom is gone as well, that update throws "window is not defined" and fails the whole run.
function requireFinishedNavigation(router: AppRouter) {
  if (router.state.status !== 'pending') {
    return
  }
  throw new Error(
    `The test ended while the router was still loading ${router.state.location.pathname}. ` +
      'Wait for what that page shows before the test ends.',
  )
}

function renderUnderProviders({
  client,
  session,
  renewal,
  subscriptions,
  ui,
}: {
  client: ApolloClient
  session: SessionStore
  renewal: RenewalBridge
  subscriptions: SubscriptionTransport
  ui: ReactElement
}): Rendered {
  const user = userEvent.setup()
  const result = render(
    <ApolloProvider client={client}>
      <MantineProvider
        defaultColorScheme="dark"
        theme={theme}
        cssVariablesResolver={cssVariablesResolver}
      >
        <AuthProvider sessionStore={session} renewal={renewal} subscriptions={subscriptions}>
          {ui}
        </AuthProvider>
      </MantineProvider>
    </ApolloProvider>,
  )
  return { ...result, user }
}
