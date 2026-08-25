import {
  Alert,
  Button,
  PasswordInput,
  Stack,
  TextInput,
} from '@mantine/core'
import { useState } from 'react'
import { AuthTitle } from '../ui/AuthShell'
import { AuthApiError, type AuthTokens } from './api'
import { useAuth } from './AuthProvider'
import { CSRF_REJECTION_MESSAGE, isCsrfRejection } from './csrf'

const FALLBACK_MESSAGE = 'Sign in failed. Please try again.'

export function LoginForm({
  onAuthenticated,
}: {
  onAuthenticated: (tokens: AuthTokens) => void
}) {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      onAuthenticated(
        await login({ email, password, deviceName: navigator.userAgent }),
      )
    } catch (caught) {
      setError(refusalMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Stack maw={360}>
        <AuthTitle>Sign in</AuthTitle>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        <TextInput
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          required
        />
        <PasswordInput
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          required
        />
        <div>
          <Button type="submit" loading={submitting}>
            Sign in
          </Button>
        </div>
      </Stack>
    </form>
  )
}

/** The server's sentence, except that only the client knows a CSRF miss is cured by reloading. */
function refusalMessage(error: unknown): string {
  if (!(error instanceof AuthApiError)) {
    return FALLBACK_MESSAGE
  }
  if (isCsrfRejection(error.status, error.code)) {
    return CSRF_REJECTION_MESSAGE
  }
  return error.serverMessage ?? FALLBACK_MESSAGE
}
