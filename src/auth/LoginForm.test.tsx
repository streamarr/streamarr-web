import { screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { LoginForm } from './LoginForm'

const TOKENS = { accessTokenExpiresAt: '2026-07-08T12:10:00Z', scope: 'profile' }

async function fillAndSubmit(user: ReturnType<typeof import('@testing-library/user-event').default.setup>) {
  await user.type(screen.getByLabelText(/^email/i), 'user@example.com')
  await user.type(screen.getByLabelText(/^password/i), 'correct horse battery staple')
  await user.click(screen.getByRole('button', { name: /sign in/i }))
}

describe('LoginForm', () => {
  it('shouldAuthenticateAndReportScopeOnSuccess', async () => {
    server.use(http.post('/api/auth/login', () => HttpResponse.json(TOKENS)))
    const onAuthenticated = vi.fn()
    const { user } = renderWithProviders(<LoginForm onAuthenticated={onAuthenticated} />)

    await fillAndSubmit(user)

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(TOKENS))
  })

  it('shouldSignInWhenAStaleAuthCookieMakesTheServerDemandCsrf', async () => {
    document.cookie = 'XSRF-TOKEN=csrf-abc'
    // A stale streamarr_access cookie rides along on the login POST, so the server's CSRF
    // matcher covers it and refuses the request unless the token cookie is echoed back —
    // and signing in is the very act that would have replaced the stale cookie.
    server.use(
      http.post('/api/auth/login', ({ request }) =>
        request.headers.get('X-XSRF-TOKEN')
          ? HttpResponse.json(TOKENS)
          : HttpResponse.json({ code: 'FORBIDDEN' }, { status: 403 }),
      ),
    )
    const onAuthenticated = vi.fn()
    const { user } = renderWithProviders(<LoginForm onAuthenticated={onAuthenticated} />)

    await fillAndSubmit(user)

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(TOKENS))
  })

  it('shouldShowMessageAndNotAuthenticateOnInvalidCredentials', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ code: 'INVALID_CREDENTIALS' }, { status: 401 }),
      ),
    )
    const onAuthenticated = vi.fn()
    const { user } = renderWithProviders(<LoginForm onAuthenticated={onAuthenticated} />)

    await fillAndSubmit(user)

    expect(await screen.findByText(/incorrect email or password/i)).toBeInTheDocument()
    expect(onAuthenticated).not.toHaveBeenCalled()
  })

  it('shouldShowThrottleMessageOnTooManyAttempts', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ code: 'TOO_MANY_ATTEMPTS' }, { status: 429 }),
      ),
    )
    const { user } = renderWithProviders(<LoginForm onAuthenticated={vi.fn()} />)

    await fillAndSubmit(user)

    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument()
  })
})
