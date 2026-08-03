import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { AuthTokens } from '../auth/api'
import { LoginForm } from '../auth/LoginForm'
import { RESUMABLE, type ResumeSearch } from '../auth/resume'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): ResumeSearch => ({
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
