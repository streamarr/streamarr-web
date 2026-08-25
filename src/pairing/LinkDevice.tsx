import { Alert, Button, Group, SegmentedControl, Stack, Text } from '@mantine/core'
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

/** Terminal states an approver can land on — none of them offer the buttons again. */
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

  // Frame 13: lookup runs on the last character — there is no submit button to find.
  async function onCodeComplete(fullCode: string) {
    setError(null)
    setSettled(null)
    setBusy(true)
    try {
      const found = await lookupPairingRequest(fullCode)
      setPairing(found)
      settle(found.status)
    } catch (caught) {
      setPairing(null)
      if (!bouncedToSignIn(caught, fullCode)) {
        setError(messageFor(caught))
      }
    } finally {
      setBusy(false)
    }
  }

  /**
   * Approving is an account action; an expired session sends the approver to sign in and back.
   * The code travels as an argument: the lookup can fire from the keystroke that completed it,
   * before that keystroke's state has committed.
   */
  function bouncedToSignIn(caught: unknown, carriedCode: string): boolean {
    if (!onUnauthenticated || !(caught instanceof AuthApiError) || caught.status !== 401) {
      return false
    }
    onUnauthenticated(carriedCode)
    return true
  }

  async function onDecide(decision: PairingDecision, householdId?: string) {
    setError(null)
    setBusy(true)
    try {
      const result = await decidePairingRequest(pairing!.userCode, decision, householdId)
      settle(result.status)
    } catch (caught) {
      await handleDecisionFailure(caught)
    } finally {
      setBusy(false)
    }
  }

  /**
   * A 409 means someone or something already decided this request. Re-read once and show the
   * authoritative outcome rather than inviting a blind resubmit that would only 409 again.
   */
  async function handleDecisionFailure(caught: unknown) {
    if (bouncedToSignIn(caught, code)) {
      return
    }
    if (!(caught instanceof AuthApiError) || caught.code !== 'DEVICE_CODE_NOT_PENDING') {
      setError(messageFor(caught))
      return
    }

    try {
      const current = await lookupPairingRequest(pairing!.userCode)
      setPairing(current)
      settle(current.status)
    } catch (lookupFailed) {
      setError(messageFor(lookupFailed))
    }
  }

  /** Only a decided request settles the page; a still-pending read keeps the choice on offer. */
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

  return (
    <Stack gap={28}>
      <h1 className="authTitle">Link your TV</h1>

      <div role="status" aria-live="polite">
        {settled && (
          <Alert color={SIGNED_IN_STATUSES.has(settled) ? 'green' : 'red'}>
            {SETTLED_MESSAGES[settled] ?? SETTLED_FALLBACK}
          </Alert>
        )}
      </div>

      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}

      {settled ? (
        <Button variant="default" onClick={startOver}>
          Link another device
        </Button>
      ) : pairing ? (
        <Stack gap={10}>
          <Text className="authLede">Code accepted</Text>
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
      ) : (
        <Stack gap={10}>
          <Text className="authLede">Enter the code shown on your TV</Text>
          <CodeInput
            label="Pairing code"
            value={code}
            onChange={(next) => {
              setCode(next)
              setError(null)
              if (next.length === 8 && !busy) {
                void onCodeComplete(next)
              }
            }}
            length={8}
            groupSize={4}
            alphanumeric
            error={error != null}
            autoFocus
          />
        </Stack>
      )}
    </Stack>
  )
}

function normalizeCode(raw: string) {
  return raw
    .replaceAll(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8)
}

/**
 * Confirmation before commitment: the approver sees which device is asking, since when, and
 * chooses the one Household the TV will be registered to (ADR 0024 §Devices). A single usable
 * Household is preselected; more than one demands an explicit choice before Approve unlocks.
 * Denying names no Household.
 */
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
  const [householdId, setHouseholdId] = useState(
    pairing.households.length === 1 ? pairing.households[0].id : '',
  )
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
        {/* The same control the profile picker uses for Households — one vocabulary for one
            choice. An unmatched value renders no thumb, so approval still demands an explicit
            pick when more than one Household is usable. */}
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
