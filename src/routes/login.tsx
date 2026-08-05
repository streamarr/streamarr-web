import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import type { AuthTokens } from '../auth/api'
import { LoginForm } from '../auth/LoginForm'
import { type ResumeSearch, sanitizeResumeTarget } from '../auth/resume'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): ResumeSearch => ({
    redirect: sanitizeResumeTarget(search.redirect),
  }),
  component: Login,
})

function Login() {
  const router = useRouter()
  const navigate = useNavigate()
  const { redirect } = Route.useSearch()

  // An interrupted destination wins: the guard (or a mid-session eviction) recorded where the
  // visitor was headed, search params and all, so resume it verbatim. Otherwise route by what
  // the tokens can already do — a profile-scoped session goes straight to the library, anything
  // less still owes the picker a choice.
  function onAuthenticated(tokens: AuthTokens) {
    if (redirect) {
      router.history.push(redirect)
      return
    }
    navigate({ to: tokens.scope === 'profile' ? '/' : '/select' })
  }

  return <LoginForm onAuthenticated={onAuthenticated} />
}
