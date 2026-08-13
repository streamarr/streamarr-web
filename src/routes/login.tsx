import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import type { AuthTokens } from '../auth/api'
import { LoginForm } from '../auth/LoginForm'
import { type ResumeSearch, sanitizeResumeTarget } from '../auth/resume'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): ResumeSearch => ({
    redirect: sanitizeResumeTarget(search.redirect),
  }),
  // Only the cached session answer may drive this bounce: /login must render without any
  // server dependency (it is the escape hatch from a broken auth state), so this never probes.
  // It turns away exactly the visitor this page can teach nothing — one the server already
  // vouched for during this document's lifetime.
  beforeLoad: ({ context }) => {
    if (context.session.peek() === 'authenticated') {
      throw redirect({ to: '/' })
    }
  },
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
