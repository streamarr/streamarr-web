import { Alert, Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core'
import { useState } from 'react'
import { AuthTitle } from '../ui/AuthShell'
import { AuthApiError, type AuthTokens } from './api'
import { useAuth } from './AuthProvider'

const MESSAGES: Record<string, string> = {
  SETUP_ALREADY_COMPLETED: 'This server has already been set up. Sign in instead.',
}
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
      const code = caught instanceof AuthApiError ? caught.code : null
      setError((code && MESSAGES[code]) ?? FALLBACK_MESSAGE)
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
