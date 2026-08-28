import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useEffect, useState } from 'react'
import {
  AuthApiError,
  type AuthTokens,
  declineInvitation,
  type InvitationPreview,
  lookupInvitation,
} from '../auth/api'
import { useAuth } from '../auth/AuthProvider'

// Frames 14/14a: the Account-invitation ceremony. The recipient has no Account yet, so the whole
// flow authenticates by the pasted code alone; every miss reads the same ("that link isn't valid
// anymore") because unknown, expired, and decided codes are deliberately indistinguishable.
// Invitation codes are opaque tokens, so this is a pasteable field — never the PIN/TV code input.

const INVALID_MESSAGE = "That invitation isn't valid anymore. Ask for a new one."

type Phase =
  | { at: 'code' }
  | { at: 'looking' }
  | { at: 'preview'; preview: InvitationPreview }
  | { at: 'declined' }

export function InvitationScreen({
  initialCode,
  onAccepted,
}: {
  initialCode?: string
  onAccepted: (tokens: AuthTokens) => void
}) {
  const [code, setCode] = useState(initialCode ?? '')
  const [phase, setPhase] = useState<Phase>({ at: 'code' })
  const [failure, setFailure] = useState<string | null>(null)

  async function lookUp(presented: string) {
    setFailure(null)
    setPhase({ at: 'looking' })
    try {
      setPhase({ at: 'preview', preview: await lookupInvitation(presented) })
    } catch (error) {
      setPhase({ at: 'code' })
      setFailure(refusalMessage(error))
    }
  }

  useEffect(() => {
    if (initialCode) {
      void lookUp(initialCode)
    }
    // The initial code arrives exactly once, from the link that opened this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (phase.at === 'looking') {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    )
  }

  if (phase.at === 'declined') {
    return (
      <Stack maw={480}>
        <Title order={2}>Invitation declined</Title>
        <Text>Nothing was created. You can close this page.</Text>
      </Stack>
    )
  }

  if (phase.at === 'preview') {
    return (
      <InvitationReview
        code={code}
        preview={phase.preview}
        onAccepted={onAccepted}
        onDeclined={() => setPhase({ at: 'declined' })}
      />
    )
  }

  return (
    <Stack maw={480}>
      <Title order={2}>Join Streamarr</Title>
      <Text>Paste the invitation code you were sent.</Text>
      {failure && (
        <Alert color="red" role="alert">
          {failure}
        </Alert>
      )}
      <TextInput
        label="Invitation code"
        value={code}
        onChange={(event) => setCode(event.currentTarget.value.trim())}
        autoFocus
      />
      <Button onClick={() => lookUp(code)} disabled={code.length === 0}>
        Look up invitation
      </Button>
    </Stack>
  )
}

function InvitationReview({
  code,
  preview,
  onAccepted,
  onDeclined,
}: {
  code: string
  preview: InvitationPreview
  onAccepted: (tokens: AuthTokens) => void
  onDeclined: () => void
}) {
  const { acceptInvitation } = useAuth()
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)

  async function accept(event: React.FormEvent) {
    event.preventDefault()
    setFailure(null)
    setBusy('accept')
    try {
      onAccepted(await acceptInvitation({ code, displayName, password }))
    } catch (error) {
      setFailure(refusalMessage(error))
    } finally {
      setBusy(null)
    }
  }

  async function decline() {
    setFailure(null)
    setBusy('decline')
    try {
      await declineInvitation(code)
      onDeclined()
    } catch (error) {
      setFailure(refusalMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <form onSubmit={accept}>
      <Stack maw={480}>
        <Title order={2}>You're invited to {preview.householdName}</Title>
        <Card withBorder>
          <Stack gap="xs">
            <Group>
              <Text fw={600}>{preview.profileName}</Text>
              {preview.profileKind === 'KID' && <Badge color="teal">Kid</Badge>}
              <Badge variant="light">{preview.householdRole}</Badge>
            </Group>
            <Text size="sm" c="dimmed">
              Your account will use {preview.recipientEmail}. The invitation expires{' '}
              {new Date(preview.expiresAt).toLocaleString()}.
            </Text>
          </Stack>
        </Card>
        {failure && (
          <Alert color="red" role="alert">
            {failure}
          </Alert>
        )}
        <TextInput
          label="Your name"
          value={displayName}
          onChange={(event) => setDisplayName(event.currentTarget.value)}
          autoFocus
          required
        />
        <PasswordInput
          label="Choose a password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          required
        />
        <Group>
          <Button type="submit" loading={busy === 'accept'} disabled={busy === 'decline'}>
            Create my account
          </Button>
          <Button
            variant="subtle"
            color="red"
            onClick={decline}
            loading={busy === 'decline'}
            disabled={busy === 'accept'}
          >
            Decline
          </Button>
        </Group>
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
  }
  return 'Something went wrong. Please try again.'
}
