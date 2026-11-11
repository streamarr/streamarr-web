import {
  Alert,
  Button,
  Center,
  Group,
  Loader,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { useEffect, useId, useState } from 'react'
import { AuthLede, AuthTitle } from '../ui/AuthShell'
import {
  AuthApiError,
  type AuthTokens,
  declineInvitation,
  type InvitationPreview,
  lookupInvitation,
} from '../auth/api'
import { useAuth } from '../auth/AuthProvider'
import { enumLabel } from './enumLabel'
import styles from './Invitation.module.css'

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
}: Readonly<{
  initialCode?: string
  onAccepted: (tokens: AuthTokens) => void
}>) {
  const [code, setCode] = useState(initialCode ?? '')
  const [phase, setPhase] = useState<Phase>({ at: 'code' })
  const [failure, setFailure] = useState<string | null>(null)

  async function lookUp(presented: string) {
    setFailure(null)
    setPhase({ at: 'looking' })
    try {
      setPhase({ at: 'preview', preview: await lookupInvitation(presented) })
    } catch (error) {
      refuseCode(error)
    }
  }

  function refuseCode(error: unknown) {
    setPhase({ at: 'code' })
    setFailure(refusalMessage(error))
  }

  useEffect(() => {
    if (initialCode) {
      // Looking up the linked code is the mount effect; it moves the screen to 'looking' at once.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
        <AuthTitle>Invitation declined</AuthTitle>
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
      <AuthTitle>Create your account</AuthTitle>
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
}: Readonly<{
  code: string
  preview: InvitationPreview
  onAccepted: (tokens: AuthTokens) => void
  onDeclined: () => void
}>) {
  const { acceptInvitation } = useAuth()
  const profileTitleId = useId()
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)

  async function accept(event: React.SubmitEvent) {
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
      await sendDecline()
    } catch (error) {
      setFailure(refusalMessage(error))
    } finally {
      setBusy(null)
    }
  }

  async function sendDecline() {
    await declineInvitation(code)
    onDeclined()
  }

  return (
    <form onSubmit={accept}>
      <Stack maw={480}>
        <AuthTitle>Create your account</AuthTitle>
        <AuthLede>You were invited to {preview.householdName}.</AuthLede>
        <section className={styles.panel} aria-labelledby={profileTitleId}>
          <h2 id={profileTitleId} className={styles.panelTitle}>
            {preview.profileName}
          </h2>
          <p className={styles.facts}>
            {preview.profileKind === 'KID' && <span>Kid</span>}
            <span>{enumLabel(preview.householdRole)}</span>
            {preview.mode === 'LINK' && <span>Your existing Profile</span>}
          </p>
          <p className={styles.note}>
            Your account will use {preview.recipientEmail}. The invitation expires{' '}
            {new Date(preview.expiresAt).toLocaleString()}.
          </p>
        </section>
        {preview.mode === 'LINK' && <ConnectReview preview={preview} />}
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
          error={mismatchError(password, confirm)}
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

function ConnectReview({ preview }: Readonly<{ preview: InvitationPreview }>) {
  const titleId = useId()
  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.panelTitle}>
        Connecting {preview.profileName} to your new account
      </h2>
      <p className={styles.body}>
        {preview.profileName} becomes your Personal Profile — its history, progress, and preferences
        come with it.
      </p>
      <ConsequenceList
        title="These people keep managing it"
        items={preview.remainingManagers}
        empty="Nobody else manages it after connecting."
      />
      <ConsequenceList
        title="These Households lose it when you accept"
        items={preview.householdsLosingProfileAccess}
        empty="It isn't visiting any other Household."
      />
      <ConsequenceList
        title="These Households will be offered it afresh"
        items={preview.profileShareOfferTargets}
        empty="No Household will be offered it again."
      />
    </section>
  )
}

function ConsequenceList({
  title,
  items,
  empty,
}: Readonly<{
  title: string
  items: string[]
  empty: string
}>) {
  if (items.length === 0) {
    return <p className={styles.note}>{empty}</p>
  }
  return (
    <div className={styles.consequences}>
      <p className={styles.consequencesTitle}>{title}</p>
      {items.map((item) => (
        <p key={item} className={styles.body}>
          · {item}
        </p>
      ))}
    </div>
  )
}

function mismatchError(password: string, confirm: string): string | undefined {
  if (confirm.length === 0 || confirm === password) {
    return undefined
  }
  return "Passwords don't match"
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
