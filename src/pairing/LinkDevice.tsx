import { Alert, Button, Group, Stack, Text, TextInput, Title } from '@mantine/core'
import { useState } from 'react'
import { AuthApiError } from '../api/http'
import {
  decidePairingRequest,
  lookupPairingRequest,
  type PairingDecision,
  type PairingRequest,
  type PairingStatus,
} from './api'

const LOOKUP_MESSAGES: Record<string, string> = {
  INVALID_USER_CODE: "That doesn't look like a pairing code. Check the code on your device.",
  DEVICE_CODE_NOT_FOUND: 'No pairing request matches that code. It may have expired — start a new one on your device.',
}
const DECISION_MESSAGES: Record<string, string> = {
  ...LOOKUP_MESSAGES,
  DEVICE_CODE_EXPIRED: 'That code expired. Start a new one on your device.',
  INVALID_DECISION: 'Something went wrong sending your choice. Please try again.',
}
const FALLBACK_MESSAGE = 'Something went wrong. Please try again.'

type SettledStatus = Exclude<PairingStatus, 'PENDING'>

/** Terminal states an approver can land on — none of them offer the buttons again. */
const SETTLED_MESSAGES: Record<SettledStatus, string> = {
  APPROVED: 'This device was approved. It should be signed in within a few seconds.',
  DENIED: 'This request was denied. The device was not signed in.',
  CONSUMED: 'This device is already signed in.',
}

export function LinkDevice({
  initialCode = '',
  onUnauthenticated,
}: {
  initialCode?: string
  onUnauthenticated?: (code: string) => void
}) {
  const [code, setCode] = useState(initialCode)
  const [pairing, setPairing] = useState<PairingRequest | null>(null)
  const [settled, setSettled] = useState<SettledStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onLookup(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSettled(null)
    setBusy(true)
    try {
      const found = await lookupPairingRequest(code)
      setPairing(found)
      settle(found.status)
    } catch (caught) {
      setPairing(null)
      if (!bouncedToSignIn(caught)) {
        setError(messageFor(caught, LOOKUP_MESSAGES))
      }
    } finally {
      setBusy(false)
    }
  }

  /** Approving is an account action; an expired session sends the approver to sign in and back. */
  function bouncedToSignIn(caught: unknown): boolean {
    if (!onUnauthenticated || !(caught instanceof AuthApiError) || caught.status !== 401) {
      return false
    }
    onUnauthenticated(code)
    return true
  }

  async function onDecide(decision: PairingDecision) {
    setError(null)
    setBusy(true)
    try {
      const result = await decidePairingRequest(pairing!.userCode, decision)
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
    if (bouncedToSignIn(caught)) {
      return
    }
    if (!(caught instanceof AuthApiError) || caught.code !== 'DEVICE_CODE_NOT_PENDING') {
      setError(messageFor(caught, DECISION_MESSAGES))
      return
    }

    try {
      const current = await lookupPairingRequest(pairing!.userCode)
      setPairing(current)
      settle(current.status)
    } catch (lookupFailed) {
      setError(messageFor(lookupFailed, DECISION_MESSAGES))
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
    <Stack maw={420}>
      <Title order={2}>Link a device</Title>
      <Text c="dimmed">
        Enter the code shown on your TV to confirm it should be signed in to your account.
      </Text>

      <div role="status" aria-live="polite">
        {settled && <Alert color={settled === 'DENIED' ? 'red' : 'green'}>{SETTLED_MESSAGES[settled]}</Alert>}
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
        <ConfirmDevice pairing={pairing} busy={busy} onDecide={onDecide} onCancel={startOver} />
      ) : (
        <EnterCode code={code} busy={busy} onChange={setCode} onSubmit={onLookup} />
      )}
    </Stack>
  )
}

function EnterCode({
  code,
  busy,
  onChange,
  onSubmit,
}: {
  code: string
  busy: boolean
  onChange: (code: string) => void
  onSubmit: (event: React.FormEvent) => void
}) {
  return (
    <form onSubmit={onSubmit}>
      <Stack>
        <TextInput
          label="Pairing code"
          description="Letters only — the hyphen is optional."
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={code}
          onChange={(event) => onChange(event.currentTarget.value)}
          required
        />
        <Button type="submit" loading={busy}>
          Continue
        </Button>
      </Stack>
    </form>
  )
}

/** Confirmation before commitment: the approver sees which device is asking, and since when. */
function ConfirmDevice({
  pairing,
  busy,
  onDecide,
  onCancel,
}: {
  pairing: PairingRequest
  busy: boolean
  onDecide: (decision: PairingDecision) => void
  onCancel: () => void
}) {
  return (
    <Stack>
      <Text>
        <strong>{pairing.deviceName}</strong> wants access to your account.
      </Text>
      <Text c="dimmed" size="sm">
        Requested {formatRequestedAt(pairing.requestedAt)} · code {pairing.userCode}
      </Text>
      <Group>
        <Button loading={busy} onClick={() => onDecide('APPROVE')}>
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

function messageFor(caught: unknown, messages: Record<string, string>): string {
  if (!(caught instanceof AuthApiError)) {
    return FALLBACK_MESSAGE
  }
  if (caught.code === 'TOO_MANY_ATTEMPTS') {
    return throttleMessage(caught.retryAfterSeconds)
  }
  return (caught.code && messages[caught.code]) ?? FALLBACK_MESSAGE
}

function throttleMessage(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null) {
    return 'Too many attempts. Wait a few minutes and try again.'
  }
  const minutes = Math.ceil(retryAfterSeconds / 60)
  return `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`
}
