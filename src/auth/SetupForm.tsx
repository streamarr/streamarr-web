import { Alert, Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core'
import { useState } from 'react'
import { AuthTitle } from '../ui/AuthShell'
import { AuthApiError, type AuthTokens } from './api'
import { useAuth } from './AuthProvider'

const ALREADY_SET_UP_MESSAGE = 'This server has already been set up.'
const SIGN_IN_INSTEAD = 'Sign in instead.'
const FALLBACK_MESSAGE = 'Setup failed. Please try again.'

export function SetupForm({ onAuthenticated }: { onAuthenticated: (tokens: AuthTokens) => void }) {
  const { setup } = useAuth()
  const [fields, setFields] = useState({
    email: '',
    displayName: '',
    password: '',
    householdName: '',
    profileName: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const bind = (key: keyof typeof fields) => ({
    value: fields[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.currentTarget.value
      setFields((current) => ({ ...current, [key]: value }))
    },
    required: true,
  })

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      onAuthenticated(await setup(fields))
    } catch (caught) {
      setError(refusalMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Stack maw={420}>
        <AuthTitle>Set up your server</AuthTitle>
        <Text c="dimmed" size="sm">
          Create the first admin account, household, and profile.
        </Text>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        <TextInput label="Email" type="email" autoComplete="username" {...bind('email')} />
        <TextInput label="Display name" {...bind('displayName')} />
        <PasswordInput label="Password" autoComplete="new-password" {...bind('password')} />
        <TextInput label="Household name" {...bind('householdName')} />
        <TextInput label="Profile name" {...bind('profileName')} />
        <Button type="submit" loading={submitting}>
          Create account
        </Button>
      </Stack>
    </form>
  )
}

/** The server's sentence, plus the one thing it cannot know: a set-up server means sign in. */
function refusalMessage(error: unknown): string {
  if (!(error instanceof AuthApiError)) {
    return FALLBACK_MESSAGE
  }
  if (error.code === 'SETUP_ALREADY_COMPLETED') {
    return `${error.serverMessage ?? ALREADY_SET_UP_MESSAGE} ${SIGN_IN_INSTEAD}`
  }
  return error.serverMessage ?? FALLBACK_MESSAGE
}
