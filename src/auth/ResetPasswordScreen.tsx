import { Alert, Anchor, Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core'
import { useState } from 'react'
import { AuthTitle } from '../ui/AuthShell'
import { AuthApiError, redeemPasswordReset } from './api'

// Redemption deliberately signs nobody in. Reset codes are opaque tokens, so this is a
// pasteable field — never the PIN/TV code input.

const INVALID_MESSAGE = "That reset code isn't valid anymore. Ask for a new one."

export function ResetPasswordScreen({ initialCode }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
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
        <AuthTitle>Password changed</AuthTitle>
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
        <AuthTitle>Choose a new password</AuthTitle>
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
        <PasswordInput
          label="Confirm password"
          value={confirm}
          onChange={(event) => setConfirm(event.currentTarget.value)}
          error={confirm.length > 0 && confirm !== newPassword ? "Passwords don't match" : undefined}
          required
        />
        <div>
          <Button type="submit" loading={busy} disabled={confirm !== newPassword}>
            Set new password
          </Button>
        </div>
        <Text size="sm" c="dimmed">
          This code works once.
        </Text>
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
