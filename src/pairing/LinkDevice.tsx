import { Alert, Button, Group, SegmentedControl, Stack, Text } from '@mantine/core'
import { AuthLede, AuthTitle } from '../ui/AuthShell'
import { CodeInput } from '../ui/CodeInput'
import { useState } from 'react'
import { AuthApiError } from '../api/http'
import {
  decidePairingRequest,
  lookupPairingRequest,
  type PairingDecision,
  type PairingRequest,
  type PairingStatus,
} from './api'

const FALLBACK_MESSAGE = 'Something went wrong. Please try again.'

const SETTLED_MESSAGES: Record<string, string> = {
  APPROVED: 'This device was approved. It should be signed in within a few seconds.',
  DENIED: 'This request was denied. The device was not signed in.',
  CONSUMED: 'This device is already signed in.',
}
// A status this build does not know still settles the page; it must still say something.
const SETTLED_FALLBACK = 'This pairing request is no longer pending. Start a new one on your device.'
const SIGNED_IN_STATUSES = new Set(['APPROVED', 'CONSUMED'])

export function LinkDevice({
  initialCode = '',
  onUnauthenticated,
}: {
  initialCode?: string
  onUnauthenticated?: (code: string) => void
}) {
  const [code, setCode] = useState(normalizeCode(initialCode))
  const [pairing, setPairing] = useState<PairingRequest | null>(null)
  const [settled, setSettled] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function onCodeChange(next: string) {
    setCode(next)
    setError(null)
    if (next.length === 8 && !busy) {
      void onCodeComplete(next)
    }
  }

  async function onCodeComplete(fullCode: string) {
    setError(null)
    setSettled(null)
    setBusy(true)
    try {
      showRequest(await lookupPairingRequest(fullCode))
    } catch (caught) {
      refuseLookup(caught, fullCode)
    } finally {
      setBusy(false)
    }
  }

  function refuseLookup(caught: unknown, carriedCode: string) {
    setPairing(null)
    if (!bouncedToSignIn(caught, carriedCode)) {
      setError(messageFor(caught))
    }
  }

  // The code travels as an argument: the lookup fires from the keystroke that completed it,
  // before that keystroke's state has committed.
  function bouncedToSignIn(caught: unknown, carriedCode: string): boolean {
    if (!onUnauthenticated || !isSessionExpired(caught)) {
      return false
    }
    onUnauthenticated(carriedCode)
    return true
  }

  async function onDecide(decision: PairingDecision, householdId?: string) {
    setError(null)
    setBusy(true)
    try {
      await sendDecision(decision, householdId)
    } catch (caught) {
      await handleDecisionFailure(caught)
    } finally {
      setBusy(false)
    }
  }

  async function sendDecision(decision: PairingDecision, householdId?: string) {
    const result = await decidePairingRequest(pairing!.userCode, decision, householdId)
    settle(result.status)
  }

  // A 409 means the request was already decided: re-read once rather than resubmit blindly.
  async function handleDecisionFailure(caught: unknown) {
    if (bouncedToSignIn(caught, code)) {
      return
    }
    if (!isAlreadyDecided(caught)) {
      setError(messageFor(caught))
      return
    }
    await showAuthoritativeOutcome()
  }

  async function showAuthoritativeOutcome() {
    try {
      showRequest(await lookupPairingRequest(pairing!.userCode))
    } catch (lookupFailed) {
      setError(messageFor(lookupFailed))
    }
  }

  function showRequest(found: PairingRequest) {
    setPairing(found)
    settle(found.status)
  }

  function settle(status: PairingStatus) {
    if (status !== 'PENDING') {
      setSettled(status)
    }
  }

  function startOver() {
    setPairing(null)
    setSettled(null)
    setError(null)
    setCode('')
  }

  function renderStep() {
    if (settled) {
      return (
        <Button variant="default" onClick={startOver}>
          Link another device
        </Button>
      )
    }

    if (pairing) {
      return (
        <Stack gap={10}>
          <AuthLede>Code accepted</AuthLede>
          <CodeInput
            label="Pairing code"
            value={code}
            onChange={() => {}}
            length={8}
            groupSize={4}
            alphanumeric
            settled
          />
          <ConfirmDevice pairing={pairing} busy={busy} onDecide={onDecide} onCancel={startOver} />
        </Stack>
      )
    }

    return (
      <Stack gap={10}>
        <AuthLede>Enter the code shown on your TV</AuthLede>
        <CodeInput
          label="Pairing code"
          value={code}
          onChange={onCodeChange}
          length={8}
          groupSize={4}
          alphanumeric
          error={error != null}
          autoFocus
        />
      </Stack>
    )
  }

  return (
    <Stack gap={28}>
      <AuthTitle>Link your TV</AuthTitle>

      <div role="status" aria-live="polite">
        {settled && <SettledNotice status={settled} />}
      </div>

      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}

      {renderStep()}
    </Stack>
  )
}

function SettledNotice({ status }: { status: string }) {
  return (
    <Alert color={SIGNED_IN_STATUSES.has(status) ? 'green' : 'red'}>
      {SETTLED_MESSAGES[status] ?? SETTLED_FALLBACK}
    </Alert>
  )
}

function isSessionExpired(caught: unknown): boolean {
  return caught instanceof AuthApiError && caught.status === 401
}

function isAlreadyDecided(caught: unknown): boolean {
  return caught instanceof AuthApiError && caught.code === 'DEVICE_CODE_NOT_PENDING'
}

function normalizeCode(raw: string) {
  return raw
    .replaceAll(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8)
}

function ConfirmDevice({
  pairing,
  busy,
  onDecide,
  onCancel,
}: {
  pairing: PairingRequest
  busy: boolean
  onDecide: (decision: PairingDecision, householdId?: string) => void
  onCancel: () => void
}) {
  const [householdId, setHouseholdId] = useState(preselectedHousehold(pairing.households))

  return (
    <Stack>
      <Text>
        <strong>{pairing.deviceName}</strong> wants access to your account.
      </Text>
      <Text c="dimmed" size="sm">
        Requested {formatRequestedAt(pairing.requestedAt)}
      </Text>
      <Stack gap={6}>
        <Text component="label" className="fieldLabel" id="household-choice-label">
          Sign it in to
        </Text>
        {/* An unmatched value renders no thumb, so several Households demand an explicit pick. */}
        <SegmentedControl
          aria-labelledby="household-choice-label"
          value={householdId}
          onChange={setHouseholdId}
          data={pairing.households.map((household) => ({
            value: household.id,
            label: household.name,
          }))}
        />
      </Stack>
      <Group>
        <Button
          loading={busy}
          disabled={householdId === ''}
          onClick={() => onDecide('APPROVE', householdId)}
        >
          Approve
        </Button>
        <Button color="red" variant="light" loading={busy} onClick={() => onDecide('DENY')}>
          Deny
        </Button>
        <Button variant="subtle" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </Group>
    </Stack>
  )
}

function preselectedHousehold(households: PairingRequest['households']): string {
  return households.length === 1 ? households[0].id : ''
}

function formatRequestedAt(requestedAt: string): string {
  const parsed = new Date(requestedAt)
  return Number.isNaN(parsed.getTime()) ? 'just now' : parsed.toLocaleString()
}

/** The server's sentence, except that only Retry-After can say how long a throttle lasts. */
function messageFor(caught: unknown): string {
  if (!(caught instanceof AuthApiError)) {
    return FALLBACK_MESSAGE
  }
  if (caught.retryAfterSeconds) {
    return throttleMessage(caught.retryAfterSeconds)
  }
  return caught.serverMessage ?? FALLBACK_MESSAGE
}

function throttleMessage(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60)
  return `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`
}
