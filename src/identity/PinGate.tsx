import { Button, Text } from '@mantine/core'
import { useState } from 'react'
import { AuthApiError } from '../auth/api'
import { CodeInput } from '../ui/CodeInput'
import { PinGateAvatar } from '../ui/ProfileTile'

const PIN_SHAPE = /^\d{4,8}$/
const FAILURE_MESSAGE = "Couldn't select that Profile. Try again."

// PINs ride the REST ceremony, never GraphQL: the server verifies, throttles, and refuses.
export function PinGate({
  profileName,
  paletteIndex,
  onSubmit,
  onSwitchProfile,
}: {
  profileName: string
  paletteIndex: number
  onSubmit: (pin: string) => Promise<void>
  onSwitchProfile: () => void
}) {
  const [pin, setPin] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !PIN_SHAPE.test(pin)) {
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      await onSubmit(pin)
    } catch (error) {
      refuse(error)
    } finally {
      setBusy(false)
    }
  }

  function refuse(error: unknown) {
    setPin('')
    setFailure(refusalMessage(error))
  }

  return (
    <form className="pinGate" onSubmit={submit}>
      <PinGateAvatar name={profileName} paletteIndex={paletteIndex} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <h1 className="authTitle">Enter {profileName}&rsquo;s PIN</h1>
        {failure && (
          <Text role="alert" style={{ color: 'var(--color-red-error-text)' }}>
            {failure}
          </Text>
        )}
        <CodeInput
          label="PIN"
          value={pin}
          onChange={setPin}
          minLength={4}
          secret
          error={failure != null}
          autoFocus
          testId="pin-input"
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Button type="submit" loading={busy} disabled={!PIN_SHAPE.test(pin)}>
            Unlock
          </Button>
          <Button type="button" variant="subtle" onClick={onSwitchProfile} disabled={busy}>
            Switch profile
          </Button>
        </div>
      </div>
    </form>
  )
}

function refusalMessage(error: unknown): string {
  if (!(error instanceof AuthApiError)) {
    return FAILURE_MESSAGE
  }
  if (error.retryAfterSeconds) {
    return `Too many attempts. Try again in ${error.retryAfterSeconds} seconds.`
  }
  return error.serverMessage ?? FAILURE_MESSAGE
}
