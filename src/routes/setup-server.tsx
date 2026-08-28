import { Alert, Center, Loader } from '@mantine/core'
import { AuthShell } from '../ui/AuthShell'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { getSetupStatus } from '../auth/api'
import type { AuthTokens } from '../auth/api'
import { SetupForm } from '../auth/SetupForm'

// First-run gate: once the server is set up, the wizard must never show again. A thrown
// redirect replaces the entry, so Back cannot return to a gate that bounces again.
export const Route = createFileRoute('/setup-server')({
  beforeLoad: async () => {
    if ((await getSetupStatus()).setupComplete) {
      throw redirect({ to: '/login' })
    }
  },
  pendingMs: 0,
  pendingComponent: CheckingServer,
  errorComponent: ServerStatusUnknown,
  component: SetupServer,
})

function SetupServer() {
  const navigate = useNavigate()

  function onAuthenticated(tokens: AuthTokens) {
    navigate({ to: tokens.scope === 'profile' ? '/' : '/select-profile' })
  }

  return (
    <AuthShell>
      <SetupForm onAuthenticated={onAuthenticated} />
    </AuthShell>
  )
}

function CheckingServer() {
  return (
    <AuthShell>
      <Center h={200}>
        <Loader role="status" aria-label="Checking the server" />
      </Center>
    </AuthShell>
  )
}

// An unreadable status is not a fresh server: showing the wizard would offer to set up a
// server that may already have an owner.
function ServerStatusUnknown() {
  return (
    <AuthShell>
      <Alert color="red" role="alert">
        Couldn't check whether this server is set up. Reload the page to try again.
      </Alert>
    </AuthShell>
  )
}
