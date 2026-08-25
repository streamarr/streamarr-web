import { screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { LoginForm } from './LoginForm'

const TOKENS = {
  accessTokenExpiresAt: '2026-07-08T12:10:00Z',
  scope: 'profile',
}

async function fillAndSubmit(
  user: ReturnType<typeof import('@testing-library/user-event').default.setup>,
) {
  await user.type(screen.getByLabelText(/^email/i), 'user@example.com')
  await user.type(
    screen.getByLabelText(/^password/i),
    'correct horse battery staple',
  )
  await user.click(screen.getByRole('button', { name: /sign in/i }))
}

describe('LoginForm', () => {
  it('shouldAuthenticateAndReportScopeOnSuccess', async () => {
    server.use(http.post('/api/auth/login', () => HttpResponse.json(TOKENS)))
    const onAuthenticated = vi.fn()
    const { user } = renderWithProviders(
      <LoginForm onAuthenticated={onAuthenticated} />,
    )

    await fillAndSubmit(user)

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(TOKENS))
  })

  it('shouldSignInWhenAStaleAuthCookieMakesTheServerDemandCsrf', async () => {
    document.cookie = 'XSRF-TOKEN=csrf-abc'
    // A stale access cookie on the login POST puts it under the server's CSRF matcher.
    server.use(
      http.post('/api/auth/login', ({ request }) =>
        request.headers.get('X-XSRF-TOKEN')
          ? HttpResponse.json(TOKENS)
          : HttpResponse.json({ code: 'FORBIDDEN' }, { status: 403 }),
      ),
    )
    const onAuthenticated = vi.fn()
    const { user } = renderWithProviders(
      <LoginForm onAuthenticated={onAuthenticated} />,
    )

    await fillAndSubmit(user)

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(TOKENS))
  })

  it('shouldShowTheServersRefusalAndNotAuthenticateOnInvalidCredentials', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
          { status: 401 },
        ),
      ),
    )
    const onAuthenticated = vi.fn()
    const { user } = renderWithProviders(
      <LoginForm onAuthenticated={onAuthenticated} />,
    )

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.')
    expect(onAuthenticated).not.toHaveBeenCalled()
  })

  it('shouldShowTheServersThrottleSentenceOnTooManyAttempts', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          {
            code: 'TOO_MANY_ATTEMPTS',
            message: 'Too many failed login attempts. Try again later.',
          },
          { status: 429 },
        ),
      ),
    )
    const { user } = renderWithProviders(
      <LoginForm onAuthenticated={vi.fn()} />,
    )

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many failed login attempts. Try again later.',
    )
  })

  it('shouldExplainHowToRecoverWhenCsrfRetryIsRejected', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          { code: 'CSRF_TOKEN_REQUIRED', message: 'The CSRF token is missing or invalid.' },
          { status: 403 },
        ),
      ),
    )
    const { user } = renderWithProviders(
      <LoginForm onAuthenticated={vi.fn()} />,
    )

    await fillAndSubmit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your session security check failed. Reload the page and try again.',
    )
  })
})
