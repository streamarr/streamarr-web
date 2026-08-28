import { Alert, Button, Group, Modal, PasswordInput, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { AuthApiError } from '../auth/api'

// Frame 15a: the PIN gate for a protected Profile. The server owns the whole ceremony —
// throttling, verification, the Household safety lock — so this dialog only collects digits and
// translates the typed refusals. Codes and PINs never touch GraphQL (ADR 0024).

const PIN_SHAPE = /^\d{4,8}$/

export function PinDialog({
  profileName,
  onSubmit,
  onClose,
}: {
  profileName: string
  onSubmit: (pin: string) => Promise<void>
  onClose: () => void
}) {
  const [pin, setPin] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setFailure(null)
    try {
      await onSubmit(pin)
    } catch (error) {
      setPin('')
      setFailure(refusalMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal opened onClose={onClose} title={`Enter the PIN for ${profileName}`} centered>
      <Stack>
        {failure && (
          <Alert color="red" role="alert">
            {failure}
          </Alert>
        )}
        <PasswordInput
          label="PIN"
          description="4 to 8 digits"
          value={pin}
          onChange={(event) => setPin(event.currentTarget.value.replaceAll(/\D/g, ''))}
          inputMode="numeric"
          autoFocus
          maxLength={8}
          data-testid="pin-input"
        />
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!PIN_SHAPE.test(pin)}>
            Watch
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          Forgot it? A manager of this Profile can change the PIN.
        </Text>
      </Stack>
    </Modal>
  )
}

function refusalMessage(error: unknown): string {
  if (error instanceof AuthApiError) {
    if (error.status === 401) {
      return "That PIN isn't right. Try again."
    }
    if (error.status === 429) {
      return error.retryAfterSeconds
        ? `Too many attempts. Try again in ${error.retryAfterSeconds} seconds.`
        : 'Too many attempts. Try again later.'
    }
    if (error.status === 409) {
      return 'This Profile is locked until a PIN is set for it.'
    }
  }
  return "Couldn't select that Profile. Try again."
}
