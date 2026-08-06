import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import {
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
  selectHousehold: (householdId: string) => Promise<AuthTokens>
  selectProfile: (profileId: string) => Promise<AuthTokens>
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

  // Every credential-issuing response updates session state, tells the store the server now
  // vouches for the visitor (so route guards agree), and hands the worker the fresh expiry (to
  // schedule proactive renewal) and CSRF token — the worker can read neither cookie.
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

  const login = useCallback((input: LoginInput) => apiLogin(input).then(adopt), [adopt])
  const setup = useCallback((input: SetupInput) => apiSetup(input).then(adopt), [adopt])
  const selectHousehold = useCallback(
    (id: string) => apiSelectHousehold(id).then(adopt),
    [adopt],
  )
  const selectProfile = useCallback((id: string) => apiSelectProfile(id).then(adopt), [adopt])
  const logout = useCallback(
    () =>
      apiLogout().then(() => {
        sessionStore.markAnonymous()
        setSession(null)
        renewal.stop()
      }),
    [renewal, sessionStore],
  )

  const value = useMemo(
    () => ({ session, login, setup, selectHousehold, selectProfile, logout }),
    [session, login, setup, selectHousehold, selectProfile, logout],
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
