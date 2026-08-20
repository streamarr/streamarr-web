import { Button, Text } from '@mantine/core'
import { useState } from 'react'
import { AuthApiError } from '../auth/api'
import { CodeInput } from '../ui/CodeInput'
import { PinGateAvatar } from '../ui/ProfileTile'

const PIN_SHAPE = /^\d{4,8}$/

// Frame 15a: the PIN gate for a protected Profile, a full state of the picker screen rather
// than a modal (principle 11 — nothing here is a one-way door). The server owns the whole
// ceremony — throttling, verification, the Household safety lock — so this collects digits
// and translates the typed refusals. Codes and PINs never touch GraphQL (ADR 0024).
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
    <div className="pinGate">
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
          <Button onClick={submit} loading={busy} disabled={!PIN_SHAPE.test(pin)}>
            Watch
          </Button>
          <Button variant="subtle" onClick={onSwitchProfile} disabled={busy}>
            Switch profile
          </Button>
        </div>
      </div>
    </div>
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
