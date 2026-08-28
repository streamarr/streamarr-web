import { useApolloClient } from '@apollo/client/react'
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import {
  type AcceptInvitationInput,
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
  children,
}: {
  sessionStore: SessionStore
  renewal: Pick<RenewalBridge, 'adoptExpiry' | 'stop'>
  children: ReactNode
}) {
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
  const selectHousehold = useCallback(
    async (id: string) => {
      const tokens = await apiSelectHousehold(id).then(adopt)
      await apollo.resetStore()
      return tokens
    },
    [adopt, apollo],
  )
  const selectProfile = useCallback(
    async (id: string, pin?: string) => {
      const tokens = await apiSelectProfile(id, pin).then(adopt)
      await apollo.resetStore()
      return tokens
    },
    [adopt, apollo],
  )
  const logout = useCallback(async () => {
    sessionStore.markAnonymous()
    setSession(null)
    renewal.stop()
    await apollo.clearStore()
    await apiLogout()
  }, [apollo, renewal, sessionStore])

  const value = useMemo(
    () => ({ session, login, setup,
      acceptInvitation, selectHousehold, selectProfile, logout }),
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
