import { screen } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'

export async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/email/i), 'owner@example.com')
  await user.type(screen.getByLabelText(/^password/i), 'hunter2!')
  await user.click(screen.getByRole('button', { name: /sign in/i }))
}
