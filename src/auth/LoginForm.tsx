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
import { CSRF_REJECTION_CODE, CSRF_REJECTION_MESSAGE } from './csrf'

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  TOO_MANY_ATTEMPTS: 'Too many attempts. Wait a few minutes and try again.',
  [CSRF_REJECTION_CODE]: CSRF_REJECTION_MESSAGE,
}
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
      const code = caught instanceof AuthApiError ? caught.code : null
      setError((code && MESSAGES[code]) ?? FALLBACK_MESSAGE)
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
