import { useApolloClient } from '@apollo/client/react'
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import {
  type AcceptInvitationInput,
  AuthApiError,
  acceptInvitation as apiAcceptInvitation,
  type AuthTokens,
  login as apiLogin,
  logout as apiLogout,
  selectHousehold as apiSelectHousehold,
  selectProfile as apiSelectProfile,
  setup as apiSetup,
  type LoginInput,
  type SetupInput,
} from './api'
import { beginIdentitySwitch } from '../graphql/client'
import type { SubscriptionTransport } from '../graphql/subscriptionTransport'
import { postCsrfTokenToServiceWorker } from './csrf'
import type { RenewalBridge } from './renewalBridge'
import type { SessionStore } from './session'

export interface Session {
  scope: string
  accessTokenExpiresAt: string
}

interface AuthContextValue {
  session: Session | null
  login: (input: LoginInput) => Promise<AuthTokens>
  setup: (input: SetupInput) => Promise<AuthTokens>
  acceptInvitation: (input: AcceptInvitationInput) => Promise<AuthTokens>
  selectHousehold: (householdId: string) => Promise<AuthTokens>
  selectProfile: (profileId: string, pin?: string) => Promise<AuthTokens>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({
  sessionStore,
  renewal,
  subscriptions,
  children,
}: Readonly<{
  sessionStore: SessionStore
  renewal: Pick<RenewalBridge, 'adoptExpiry' | 'stop'>
  subscriptions: Pick<SubscriptionTransport, 'stop' | 'replaceSocket'>
  children: ReactNode
}>) {
  const [session, setSession] = useState<Session | null>(null)

  const apollo = useApolloClient()

  // The worker can read neither cookie, so every credential-issuing response hands it the
  // expiry and the CSRF token.
  const adopt = useCallback(
    (tokens: AuthTokens): AuthTokens => {
      sessionStore.markAuthenticated()
      setSession({ scope: tokens.scope, accessTokenExpiresAt: tokens.accessTokenExpiresAt })
      renewal.adoptExpiry(tokens.accessTokenExpiresAt)
      postCsrfTokenToServiceWorker()
      return tokens
    },
    [renewal, sessionStore],
  )

  // The document may have served another Account: clearStore, not resetStore — nothing should
  // be watching, and a refetch failure must not fail a sign-in that already succeeded.
  const adoptNewIdentity = useCallback(
    async (tokens: AuthTokens): Promise<AuthTokens> => {
      await apollo.clearStore()
      return adopt(tokens)
    },
    [adopt, apollo],
  )

  const login = useCallback(
    (input: LoginInput) => apiLogin(input).then(adoptNewIdentity),
    [adoptNewIdentity],
  )
  const setup = useCallback(
    (input: SetupInput) => apiSetup(input).then(adoptNewIdentity),
    [adoptNewIdentity],
  )
  const acceptInvitation = useCallback(
    (input: AcceptInvitationInput) => apiAcceptInvitation(input).then(adoptNewIdentity),
    [adoptNewIdentity],
  )
  // A different Household or Profile is a different identity: nothing cached survives the switch.
  // The new identity's cookie lands with the response, before the store resets, so the client
  // holds every operation from the request on (beginIdentitySwitch), and only a refusal from the
  // server proves the identity unchanged. The socket keeps the authority it opened with, so it goes
  // first; otherwise its next frame could land in the cache the refetch is rebuilding.
  const forgetEarlierIdentity = useCallback(async () => {
    subscriptions.replaceSocket()
    await apollo.resetStore()
  }, [apollo, subscriptions])
  const switchIdentity = useCallback(
    async (
      request: (options: { mayResend: () => boolean }) => Promise<AuthTokens>,
    ): Promise<AuthTokens> => {
      const identitySwitch = beginIdentitySwitch(apollo)
      let tokens: AuthTokens
      try {
        tokens = await request({ mayResend: identitySwitch.isCurrent })
      } catch (error) {
        if (error instanceof AuthApiError) {
          identitySwitch.failed()
          throw error
        }
        // An answer that could not be read may still have installed the new identity's cookie.
        identitySwitch.succeeded()
        await forgetEarlierIdentity().catch(() => undefined)
        throw error
      }
      identitySwitch.succeeded()
      try {
        adopt(tokens)
      } finally {
        await forgetEarlierIdentity()
      }
      return tokens
    },
    [adopt, apollo, forgetEarlierIdentity],
  )
  const selectHousehold = useCallback(
    (id: string) => switchIdentity((options) => apiSelectHousehold(id, options)),
    [switchIdentity],
  )
  const selectProfile = useCallback(
    (id: string, pin?: string) => switchIdentity((options) => apiSelectProfile(id, pin, options)),
    [switchIdentity],
  )
  const logout = useCallback(async () => {
    sessionStore.markAnonymous()
    setSession(null)
    renewal.stop()
    subscriptions.stop()
    await apollo.clearStore()
    await apiLogout()
  }, [apollo, renewal, sessionStore, subscriptions])

  const value = useMemo(
    () => ({ session, login, setup, acceptInvitation, selectHousehold, selectProfile, logout }),
    [session, login, setup, acceptInvitation, selectHousehold, selectProfile, logout],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
