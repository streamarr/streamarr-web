import { MantineProvider } from '@mantine/core'
import { render, type RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { AuthProvider } from '../auth/AuthProvider'

/** Renders under the app's providers (Mantine + AuthProvider) and returns a userEvent instance. */
export function renderWithProviders(ui: ReactElement): RenderResult & {
  user: ReturnType<typeof userEvent.setup>
} {
  const user = userEvent.setup()
  const result = render(
    <MantineProvider defaultColorScheme="dark">
      <AuthProvider>{ui}</AuthProvider>
    </MantineProvider>,
  )
  return { ...result, user }
}
