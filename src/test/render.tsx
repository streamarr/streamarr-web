import { ApolloProvider } from '@apollo/client/react'
import { MantineProvider } from '@mantine/core'
import { render, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import { createApolloClient } from '../graphql/client'

/**
 * Renders under the app's providers (Apollo + Mantine + AuthProvider) with a fresh Apollo client
 * per render so its cache never leaks between tests. GraphQL requests hit /graphql, where MSW's
 * graphql handlers intercept them.
 */
export function renderWithProviders(ui: ReactElement): RenderResult & {
  user: ReturnType<typeof userEvent.setup>
} {
  const user = userEvent.setup()
  const client = createApolloClient(vi.fn())
  const result = render(
    <ApolloProvider client={client}>
      <MantineProvider defaultColorScheme="dark">
        <AuthProvider>{ui}</AuthProvider>
      </MantineProvider>
    </ApolloProvider>,
  )
  return { ...result, user }
}
