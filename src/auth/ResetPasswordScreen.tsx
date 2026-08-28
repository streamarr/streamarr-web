import { Alert, Anchor, Button, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { useState } from 'react'
import { AuthApiError, redeemPasswordReset } from './api'

// Frame 12b: password-reset redemption. A ServerAdmin issued the code; redemption works even
// while the Account is disabled, changes the password, revokes every refresh session, and
// deliberately signs nobody in — the person continues to the sign-in page with the new password.
// Reset codes are opaque tokens, so this is a pasteable field — never the PIN/TV code input.

const INVALID_MESSAGE = "That reset code isn't valid anymore. Ask for a new one."

export function ResetPasswordScreen({ initialCode }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function redeem(event: React.FormEvent) {
    event.preventDefault()
    setFailure(null)
    setBusy(true)
    try {
      await redeemPasswordReset(code, newPassword)
      setDone(true)
    } catch (error) {
      setFailure(refusalMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Stack maw={480}>
        <Title order={2}>Password changed</Title>
        <Text>
          Every signed-in session was signed out. <Anchor href="/login">Sign in</Anchor> with your
          new password.
        </Text>
      </Stack>
    )
  }

  return (
    <form onSubmit={redeem}>
      <Stack maw={480}>
        <Title order={2}>Reset your password</Title>
        {failure && (
          <Alert color="red" role="alert">
            {failure}
          </Alert>
        )}
        <TextInput
          label="Reset code"
          value={code}
          onChange={(event) => setCode(event.currentTarget.value.trim())}
          autoFocus={!initialCode}
          required
        />
        <PasswordInput
          label="New password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.currentTarget.value)}
          autoFocus={Boolean(initialCode)}
          required
        />
        <Button type="submit" loading={busy}>
          Change password
        </Button>
      </Stack>
    </form>
  )
}

function refusalMessage(error: unknown): string {
  if (error instanceof AuthApiError) {
    if (error.status === 404) {
      return INVALID_MESSAGE
    }
    if (error.status === 429) {
      return error.retryAfterSeconds
        ? `Too many attempts. Try again in ${error.retryAfterSeconds} seconds.`
        : 'Too many attempts. Try again later.'
    }
    if (error.status === 400) {
      return 'That password cannot be used. Choose a different one.'
    }
  }
  return 'Something went wrong. Please try again.'
}
