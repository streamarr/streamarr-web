import { screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { SetupForm } from './SetupForm'

const TOKENS = { accessTokenExpiresAt: '2026-07-08T12:10:00Z', scope: 'profile' }

async function completeWizard(
  user: ReturnType<typeof import('@testing-library/user-event').default.setup>,
) {
  await user.type(screen.getByLabelText(/^email/i), 'admin@example.com')
  await user.type(screen.getByLabelText(/display name/i), 'Admin')
  await user.type(screen.getByLabelText(/^password/i), 'correct horse battery staple')
  await user.type(screen.getByLabelText(/household name/i), 'Home')
  await user.type(screen.getByLabelText(/profile name/i), 'Owner')
  await user.click(screen.getByRole('button', { name: /create/i }))
}

describe('SetupForm', () => {
  it('shouldCreateIdentityAndAuthenticateOnSubmit', async () => {
    let body: unknown
    server.use(
      http.post('/api/auth/setup', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(TOKENS, { status: 201 })
      }),
    )
    const onAuthenticated = vi.fn()
    const { user } = renderWithProviders(<SetupForm onAuthenticated={onAuthenticated} />)

    await completeWizard(user)

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(TOKENS))
    expect(body).toMatchObject({
      email: 'admin@example.com',
      displayName: 'Admin',
      householdName: 'Home',
      profileName: 'Owner',
      cookieMode: true,
    })
  })

  it('shouldShowTheServersRefusalAndPointAtSignInWhenSetupAlreadyCompleted', async () => {
    server.use(
      http.post('/api/auth/setup', () =>
        HttpResponse.json(
          {
            code: 'SETUP_ALREADY_COMPLETED',
            message: 'Server setup has already been completed.',
          },
          { status: 409 },
        ),
      ),
    )
    const { user } = renderWithProviders(<SetupForm onAuthenticated={vi.fn()} />)

    await completeWizard(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Server setup has already been completed. Sign in instead.',
    )
  })
})
