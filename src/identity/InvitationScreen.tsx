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

const FAILURE_MESSAGE = 'Something went wrong. Please try again.'

type Phase =
  | { at: 'code' }
  | { at: 'looking' }
  | { at: 'preview'; preview: InvitationPreview }
  | { at: 'declined' }

// The recipient has no Account yet: the pasted code alone authenticates lookup, accept, and decline.
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
        <h1 className="authTitle">Invitation declined</h1>
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
      <h1 className="authTitle">Create your account</h1>
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
  const [confirm, setConfirm] = useState('')
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
        <h1 className="authTitle">Create your account</h1>
        <Text className="authLede">You were invited to {preview.householdName}.</Text>
        <Card withBorder>
          <Stack gap="xs">
            <Group>
              <Text fw={600}>{preview.profileName}</Text>
              {preview.profileKind === 'KID' && <Badge color="teal">Kid</Badge>}
              <Badge variant="light">{preview.householdRole}</Badge>
              {preview.mode === 'CONNECT' && <Badge color="grape">Your existing Profile</Badge>}
            </Group>
            <Text size="sm" c="dimmed">
              Your account will use {preview.recipientEmail}. The invitation expires{' '}
              {new Date(preview.expiresAt).toLocaleString()}.
            </Text>
          </Stack>
        </Card>
        {preview.mode === 'CONNECT' && <ConnectReview preview={preview} />}
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
        <PasswordInput
          label="Confirm password"
          value={confirm}
          onChange={(event) => setConfirm(event.currentTarget.value)}
          error={confirm.length > 0 && confirm !== password ? "Passwords don't match" : undefined}
          required
        />
        <Group>
          <Button
            type="submit"
            loading={busy === 'accept'}
            disabled={busy === 'decline' || confirm !== password}
          >
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

function ConnectReview({ preview }: { preview: InvitationPreview }) {
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Text fw={600}>Connecting {preview.profileName} to your new account</Text>
        <Text size="sm">
          {preview.profileName} becomes your Personal Profile — its history, progress, and
          preferences come with it.
        </Text>
        <ConsequenceList
          title="These people keep managing it"
          items={preview.remainingManagers}
          empty="Nobody else manages it after connecting."
        />
        <ConsequenceList
          title="These Households lose it when you accept"
          items={preview.endingHouseholds}
          empty="It isn't visiting any other Household."
        />
        <ConsequenceList
          title="These Households will be offered it afresh"
          items={preview.reofferHouseholds}
          empty="No Household will be offered it again."
        />
      </Stack>
    </Card>
  )
}

function ConsequenceList({
  title,
  items,
  empty,
}: {
  title: string
  items: string[]
  empty: string
}) {
  if (items.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {empty}
      </Text>
    )
  }
  return (
    <Stack gap={2}>
      <Text size="sm" fw={600}>
        {title}
      </Text>
      {items.map((item) => (
        <Text key={item} size="sm">
          · {item}
        </Text>
      ))}
    </Stack>
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
