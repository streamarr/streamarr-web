import type { ApolloClient } from '@apollo/client'
import { ApolloProvider } from '@apollo/client/react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { graphql, HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../test/server'
import { createApolloClient } from '../graphql/client'
import {
  MeDocument,
  SetLanguageOverrideDocument,
  type SetLanguageOverrideMutation,
  type SetLanguageOverrideMutationVariables,
} from '../graphql/generated/graphql'
import { meFixture } from '../test/meFixture'
import { AuthProvider, useAuth } from './AuthProvider'
import { CSRF_REJECTION_CODE } from './csrf'
import { createSessionStore, type SessionStore } from './session'

const TOKENS = {
  accessTokenExpiresAt: '2026-08-06T12:10:00Z',
  scope: 'profile',
}

function LoginHarness() {
  const auth = useAuth()
  return (
    <button
      onClick={() => void auth.login({ email: 'user@example.com', password: 'correct password' })}
    >
      Sign in
    </button>
  )
}

function LogoutHarness() {
  const auth = useAuth()
  return <button onClick={() => void auth.logout().catch(() => {})}>Sign out</button>
}

function SwitchHarness() {
  const auth = useAuth()
  return (
    <>
      <button onClick={() => void auth.selectProfile('profile-2')}>Switch profile</button>
      <button onClick={() => void auth.selectHousehold('household-2')}>Switch household</button>
    </>
  )
}

function PinHarness() {
  const auth = useAuth()
  return (
    <button onClick={() => void auth.selectProfile('profile-2', '0000').catch(() => {})}>
      Enter PIN
    </button>
  )
}

function subscriptionsFake() {
  return { stop: vi.fn(), replaceSocket: vi.fn() }
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
    const subscriptions = subscriptionsFake()
    render(
      <ApolloProvider client={createApolloClient(() => {})}>
        <AuthProvider sessionStore={session} renewal={renewal} subscriptions={subscriptions}>
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
    server.use(http.post('/api/auth/refresh/revoke', () => new HttpResponse(null, { status: 204 })))
    const renewal = {
      adoptExpiry: vi.fn(),
      refreshNow: vi.fn(),
      stop: vi.fn(),
    }
    const session = createSessionStore(async () => 'authenticated')
    const subscriptions = subscriptionsFake()
    render(
      <ApolloProvider client={createApolloClient(() => {})}>
        <AuthProvider sessionStore={session} renewal={renewal} subscriptions={subscriptions}>
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
    const subscriptions = subscriptionsFake()
    render(
      <ApolloProvider client={createApolloClient(() => {})}>
        <AuthProvider sessionStore={session} renewal={renewal} subscriptions={subscriptions}>
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
      data: { me: meFixture({ scope: 'profile' }) },
    })
    const renewal = { adoptExpiry: vi.fn(), refreshNow: vi.fn(), stop: vi.fn() }
    const subscriptions = subscriptionsFake()
    render(
      <ApolloProvider client={client}>
        <AuthProvider sessionStore={session} renewal={renewal} subscriptions={subscriptions}>
          <LoginHarness />
          <LogoutHarness />
          <SwitchHarness />
        </AuthProvider>
      </ApolloProvider>,
    )
    return { client, subscriptions }
  }

  it('shouldForgetTheCachedIdentityOnSignOut', async () => {
    server.use(http.post('/api/auth/refresh/revoke', () => new HttpResponse(null, { status: 204 })))
    const { client } = renderWithSeededIdentity(createSessionStore(async () => 'authenticated'))
    expect(client.readQuery({ query: MeDocument })).not.toBeNull()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(client.readQuery({ query: MeDocument })).toBeNull())
  })

  it('shouldCloseTheSubscriptionSocketOnSignOut', async () => {
    server.use(http.post('/api/auth/refresh/revoke', () => new HttpResponse(null, { status: 204 })))
    const { subscriptions } = renderWithSeededIdentity(
      createSessionStore(async () => 'authenticated'),
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(subscriptions.stop).toHaveBeenCalledOnce())
    expect(subscriptions.replaceSocket).not.toHaveBeenCalled()
  })

  it.each([
    { button: 'Switch profile', endpoint: '/api/auth/select-profile' },
    { button: 'Switch household', endpoint: '/api/auth/select-household' },
  ])(
    'shouldReplaceTheSocketBeforeForgettingTheEarlierIdentityOn$button',
    async ({ button, endpoint }) => {
      server.use(http.post(endpoint, () => HttpResponse.json(TOKENS)))
      const { client, subscriptions } = renderWithSeededIdentity(
        createSessionStore(async () => 'authenticated'),
      )
      let cachedWhenReplaced: unknown
      subscriptions.replaceSocket.mockImplementation(() => {
        cachedWhenReplaced = client.readQuery({ query: MeDocument })
      })

      await userEvent.setup().click(screen.getByRole('button', { name: button }))

      await waitFor(() => expect(client.readQuery({ query: MeDocument })).toBeNull())
      expect(subscriptions.replaceSocket).toHaveBeenCalledOnce()
      expect(cachedWhenReplaced).not.toBeNull()
      expect(subscriptions.stop).not.toHaveBeenCalled()
    },
  )

  it('shouldForgetTheCachedIdentityOnSignIn', async () => {
    server.use(http.post('/api/auth/login', () => HttpResponse.json(TOKENS)))
    const { client } = renderWithSeededIdentity(createSessionStore(async () => 'anonymous'))
    expect(client.readQuery({ query: MeDocument })).not.toBeNull()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(client.readQuery({ query: MeDocument })).toBeNull())
  })
})

// The browser installs the new identity's cookie when the switch's response arrives, before the
// client has read the response, so the cookie names a profile here and the server reads it.
describe('AuthProvider operations during an identity switch', () => {
  const SWITCHES = [
    { button: 'Switch profile', endpoint: '/api/auth/select-profile' },
    { button: 'Switch household', endpoint: '/api/auth/select-household' },
  ]

  function renderSwitchable() {
    const client = createApolloClient(() => {})
    client.writeQuery({ query: MeDocument, data: { me: meFixture({ scope: 'profile' }) } })
    render(
      <ApolloProvider client={client}>
        <AuthProvider
          sessionStore={createSessionStore(async () => 'authenticated')}
          renewal={{ adoptExpiry: vi.fn(), stop: vi.fn() }}
          subscriptions={subscriptionsFake()}
        >
          <SwitchHarness />
          <PinHarness />
        </AuthProvider>
      </ApolloProvider>,
    )
    return client
  }

  function serveOverridesUnder(cookie: { profile: string }): string[] {
    const storedUnder: string[] = []
    server.use(
      graphql.mutation<SetLanguageOverrideMutation, SetLanguageOverrideMutationVariables>(
        'SetLanguageOverride',
        () => {
          storedUnder.push(cookie.profile)
          return HttpResponse.json({
            data: { setLanguageOverride: { item: null, userErrors: [] } },
          })
        },
      ),
    )
    return storedUnder
  }

  // Settles to 'stored' or to the refusal, so a refusal before the test awaits it is not unhandled.
  function storeOverride(client: ApolloClient): Promise<'stored' | Error> {
    return client
      .mutate({
        mutation: SetLanguageOverrideDocument,
        variables: { input: { itemId: 'episode-1', audioLanguage: 'JA' } },
      })
      .then(
        () => 'stored' as const,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
      )
  }

  it.each(SWITCHES)(
    'shouldSendNothingUnderTheNewIdentityWhenTheEarlierOneSendsAsTheSwitchArrivesOn$button',
    async ({ button, endpoint }) => {
      const cookie = { profile: 'profile-1' }
      const storedUnder = serveOverridesUnder(cookie)
      const client = renderSwitchable()
      let lateStore: Promise<'stored' | Error> | undefined
      server.use(
        http.post(endpoint, () => {
          cookie.profile = 'profile-2'
          lateStore = storeOverride(client)
          return HttpResponse.json(TOKENS)
        }),
      )

      await userEvent.setup().click(screen.getByRole('button', { name: button }))

      await waitFor(() => expect(lateStore).toBeDefined())
      expect(await lateStore).toBeInstanceOf(Error)
      expect(storedUnder).toEqual([])
    },
  )

  it('shouldSendTheHeldOperationUnderTheEarlierIdentityWhenTheSwitchFails', async () => {
    const cookie = { profile: 'profile-1' }
    const storedUnder = serveOverridesUnder(cookie)
    const client = renderSwitchable()
    let heldStore: Promise<'stored' | Error> | undefined
    server.use(
      http.post('/api/auth/select-profile', () => {
        heldStore = storeOverride(client)
        return HttpResponse.json({ status: 403, title: 'Forbidden' }, { status: 403 })
      }),
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'Enter PIN' }))

    await waitFor(() => expect(heldStore).toBeDefined())
    expect(await heldStore).toBe('stored')
    expect(storedUnder).toEqual(['profile-1'])
  })

  it.each(SWITCHES)(
    'shouldSendUnderTheNewIdentityWhenTheSwitchHasResetTheStoreOn$button',
    async ({ button, endpoint }) => {
      const cookie = { profile: 'profile-1' }
      const storedUnder = serveOverridesUnder(cookie)
      const client = renderSwitchable()
      server.use(
        http.post(endpoint, () => {
          cookie.profile = 'profile-2'
          return HttpResponse.json(TOKENS)
        }),
      )

      await userEvent.setup().click(screen.getByRole('button', { name: button }))
      await waitFor(() => expect(client.readQuery({ query: MeDocument })).toBeNull())

      expect(await storeOverride(client)).toBe('stored')
      expect(storedUnder).toEqual(['profile-2'])
    },
  )
})

describe('AuthProvider identity fence beyond the first send', () => {
  function renderSwitchable() {
    const client = createApolloClient(() => {})
    client.writeQuery({ query: MeDocument, data: { me: meFixture({ scope: 'profile' }) } })
    render(
      <ApolloProvider client={client}>
        <AuthProvider
          sessionStore={createSessionStore(async () => 'authenticated')}
          renewal={{ adoptExpiry: vi.fn(), stop: vi.fn() }}
          subscriptions={subscriptionsFake()}
        >
          <SwitchHarness />
          <PinHarness />
        </AuthProvider>
      </ApolloProvider>,
    )
    return client
  }

  function storeOverride(client: ApolloClient): Promise<'stored' | Error> {
    return client
      .mutate({
        mutation: SetLanguageOverrideDocument,
        variables: { input: { itemId: 'episode-1', audioLanguage: 'JA' } },
      })
      .then(
        () => 'stored' as const,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
      )
  }

  it('shouldSendNoCsrfRetryUnderTheNewIdentityWhenTheRejectionArrivesAfterTheSwitch', async () => {
    const cookie = { profile: 'profile-1' }
    const sentUnder: string[] = []
    let releaseRejection: () => void = () => {}
    const rejectionHeld = new Promise<void>((resolve) => {
      releaseRejection = resolve
    })
    server.use(
      // A CSRF rejection is the server's REST error body, not a GraphQL response.
      http.post('/graphql', async ({ request }) => {
        const { operationName } = (await request.clone().json()) as { operationName?: string }
        if (operationName !== 'SetLanguageOverride') return undefined
        sentUnder.push(cookie.profile)
        if (sentUnder.length === 1) {
          await rejectionHeld
          return HttpResponse.json({ code: CSRF_REJECTION_CODE }, { status: 403 })
        }
        return HttpResponse.json({
          data: { setLanguageOverride: { item: null, userErrors: [] } },
        })
      }),
      http.post('/api/auth/select-profile', () => {
        cookie.profile = 'profile-2'
        return HttpResponse.json(TOKENS)
      }),
    )
    const client = renderSwitchable()
    const store = storeOverride(client)
    await waitFor(() => expect(sentUnder).toEqual(['profile-1']))

    await userEvent.setup().click(screen.getByRole('button', { name: 'Switch profile' }))
    await waitFor(() => expect(client.readQuery({ query: MeDocument })).toBeNull())
    releaseRejection()

    expect(await store).toBeInstanceOf(Error)
    expect(sentUnder).toEqual(['profile-1'])
  })

  it('shouldRefuseHeldOperationsAndResetTheStoreWhenTheSwitchAnswerCannotBeRead', async () => {
    const cookie = { profile: 'profile-1' }
    const sentUnder: string[] = []
    let heldStore: Promise<'stored' | Error> | undefined
    const client = renderSwitchable()
    server.use(
      graphql.mutation<SetLanguageOverrideMutation, SetLanguageOverrideMutationVariables>(
        'SetLanguageOverride',
        () => {
          sentUnder.push(cookie.profile)
          return HttpResponse.json({
            data: { setLanguageOverride: { item: null, userErrors: [] } },
          })
        },
      ),
      http.post('/api/auth/select-profile', () => {
        cookie.profile = 'profile-2'
        heldStore = storeOverride(client)
        return new HttpResponse('{"accessTokenExpiresAt":', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'Enter PIN' }))

    await waitFor(() => expect(heldStore).toBeDefined())
    expect(await heldStore).toBeInstanceOf(Error)
    expect(sentUnder).toEqual([])
    await waitFor(() => expect(client.readQuery({ query: MeDocument })).toBeNull())
  })
})
