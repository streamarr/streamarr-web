import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { AuthTokens } from '../auth/api'
import { LoginForm } from '../auth/LoginForm'

export const Route = createFileRoute('/login')({
  component: Login,
})

function Login() {
  const navigate = useNavigate()

  // A profile-scoped token means auto-selection already landed a profile — go straight to the
  // library. Anything less means the picker still needs a choice.
  function onAuthenticated(tokens: AuthTokens) {
    navigate({ to: tokens.scope === 'profile' ? '/' : '/select' })
  }

  return <LoginForm onAuthenticated={onAuthenticated} />
}
