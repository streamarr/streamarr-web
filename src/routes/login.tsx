import { AuthShell } from '../ui/AuthShell'
import {
  createFileRoute,
  redirect,
  useLocation,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
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
  // The interrupted destination's fragment, which rides as this page's own.
  const fragment = useLocation({ select: (location) => location.hash })

  // An interrupted destination wins; otherwise route by what the tokens can already do. It takes
  // this page's place, so no history entry keeps what the fragment carried.
  function onAuthenticated(tokens: AuthTokens) {
    if (redirect) {
      router.history.replace(fragment ? `${redirect}#${fragment}` : redirect)
      return
    }
    void navigate({ to: tokens.scope === 'profile' ? '/' : '/select-profile' })
  }

  return (
    <AuthShell>
      <LoginForm onAuthenticated={onAuthenticated} />
    </AuthShell>
  )
}
