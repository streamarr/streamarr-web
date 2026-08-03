import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { AuthTokens } from '../auth/api'
import { LoginForm } from '../auth/LoginForm'

// Only a known internal destination may be resumed after signing in. Echoing an arbitrary
// redirect target back into a navigation is how open-redirect bugs get in.
const RESUMABLE = '/link'

interface LoginSearch {
  redirect?: typeof RESUMABLE
  code?: string
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: search.redirect === RESUMABLE ? RESUMABLE : undefined,
    code: typeof search.code === 'string' ? search.code : undefined,
  }),
  component: Login,
})

function Login() {
  const navigate = useNavigate()
  const { redirect, code } = Route.useSearch()

  // A profile-scoped token means auto-selection already landed a profile — go straight to the
  // library. Anything less means the picker still needs a choice. Linking a device only needs an
  // account-scoped session, so a pending approval resumes ahead of the picker.
  function onAuthenticated(tokens: AuthTokens) {
    if (redirect === RESUMABLE) {
      navigate({ to: RESUMABLE, search: code ? { code } : {} })
      return
    }
    navigate({ to: tokens.scope === 'profile' ? '/' : '/select' })
  }

  return <LoginForm onAuthenticated={onAuthenticated} />
}
