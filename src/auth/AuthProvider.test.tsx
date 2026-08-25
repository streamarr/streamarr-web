import { ApolloProvider } from '@apollo/client/react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../test/server'
import { createApolloClient } from '../graphql/client'
import { MeDocument, type MeQuery } from '../graphql/generated/graphql'
import { meFixture } from '../test/meFixture'
import { AuthProvider, useAuth } from './AuthProvider'
import { createSessionStore, type SessionStore } from './session'

const TOKENS = {
  accessTokenExpiresAt: '2026-08-06T12:10:00Z',
  scope: 'profile',
}

function LoginHarness() {
  const auth = useAuth()
  return (
    <button
      onClick={() =>
        void auth.login({ email: 'user@example.com', password: 'correct password' })
      }
    >
      Sign in
    </button>
  )
}

function LogoutHarness() {
  const auth = useAuth()
  return <button onClick={() => void auth.logout().catch(() => {})}>Sign out</button>
}

describe('AuthProvider renewal', () => {
  it('shouldAdoptEveryCredentialIssuingResponseIntoRenewal', async () => {
    server.use(http.post('/api/auth/login', () => HttpResponse.json(TOKENS)))
    const renewal = {
      adoptExpiry: vi.fn(),
      refreshNow: vi.fn(),
      stop: vi.fn(),
    }
    const session = createSessionStore(async () => 'anonymous')
    render(
      <ApolloProvider client={createApolloClient(() => {})}>
      <AuthProvider sessionStore={session} renewal={renewal}>
        <LoginHarness />
      </AuthProvider>
      </ApolloProvider>,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(renewal.adoptExpiry).toHaveBeenCalledWith(TOKENS.accessTokenExpiresAt)
    })
  })

  it('shouldStopRenewalAfterLogoutCompletes', async () => {
    server.use(
      http.post('/api/auth/refresh/revoke', () => new HttpResponse(null, { status: 204 })),
    )
    const renewal = {
      adoptExpiry: vi.fn(),
      refreshNow: vi.fn(),
      stop: vi.fn(),
    }
    const session = createSessionStore(async () => 'authenticated')
    render(
      <ApolloProvider client={createApolloClient(() => {})}>
      <AuthProvider sessionStore={session} renewal={renewal}>
        <LogoutHarness />
      </AuthProvider>
      </ApolloProvider>,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(renewal.stop).toHaveBeenCalledOnce())
  })

  it('shouldClearLocalSessionWhenServerRevocationFails', async () => {
    server.use(
      http.post('/api/auth/logout', () => HttpResponse.json({}, { status: 503 })),
      http.post('/api/auth/refresh/revoke', () => HttpResponse.json({}, { status: 503 })),
    )
    const renewal = {
      adoptExpiry: vi.fn(),
      refreshNow: vi.fn(),
      stop: vi.fn(),
    }
    const session = createSessionStore(async () => 'authenticated')
    session.markAuthenticated()
    render(
      <ApolloProvider client={createApolloClient(() => {})}>
      <AuthProvider sessionStore={session} renewal={renewal}>
        <LogoutHarness />
      </AuthProvider>
      </ApolloProvider>,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(session.peek()).toBe('anonymous'))
    expect(renewal.stop).toHaveBeenCalledOnce()
  })
})

describe('AuthProvider identity cache', () => {
  function renderWithSeededIdentity(session: SessionStore) {
    const client = createApolloClient(() => {})
    client.writeQuery({
      query: MeDocument,
      data: { me: meFixture({ scope: 'profile' }) as MeQuery['me'] },
    })
    const renewal = { adoptExpiry: vi.fn(), refreshNow: vi.fn(), stop: vi.fn() }
    render(
      <ApolloProvider client={client}>
        <AuthProvider sessionStore={session} renewal={renewal}>
          <LoginHarness />
          <LogoutHarness />
        </AuthProvider>
      </ApolloProvider>,
    )
    return client
  }

  it('shouldForgetTheCachedIdentityOnSignOut', async () => {
    server.use(
      http.post('/api/auth/refresh/revoke', () => new HttpResponse(null, { status: 204 })),
    )
    const client = renderWithSeededIdentity(createSessionStore(async () => 'authenticated'))
    expect(client.readQuery({ query: MeDocument })).not.toBeNull()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(client.readQuery({ query: MeDocument })).toBeNull())
  })

  it('shouldForgetTheCachedIdentityOnSignIn', async () => {
    server.use(http.post('/api/auth/login', () => HttpResponse.json(TOKENS)))
    const client = renderWithSeededIdentity(createSessionStore(async () => 'anonymous'))
    expect(client.readQuery({ query: MeDocument })).not.toBeNull()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(client.readQuery({ query: MeDocument })).toBeNull())
  })
})
