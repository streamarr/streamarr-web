import { AuthShell } from '../ui/AuthShell'
import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import type { AuthTokens } from '../auth/api'
import { LoginForm } from '../auth/LoginForm'
import { type ResumeSearch, sanitizeResumeTarget } from '../auth/resume'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): ResumeSearch => ({
    redirect: sanitizeResumeTarget(search.redirect),
  }),
  // Never probes: /login is the escape hatch from a broken auth state.
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

  // An interrupted destination wins; otherwise route by what the tokens can already do.
  function onAuthenticated(tokens: AuthTokens) {
    if (redirect) {
      router.history.push(redirect)
      return
    }
    navigate({ to: tokens.scope === 'profile' ? '/' : '/select-profile' })
  }

  return (
    <AuthShell>
      <LoginForm onAuthenticated={onAuthenticated} />
    </AuthShell>
  )
}
