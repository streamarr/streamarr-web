import { useApolloClient } from '@apollo/client/react'
import { Center, Loader } from '@mantine/core'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { getSetupStatus, ServerStatusUnavailableError } from '../auth/api'
import { CSRF_REJECTION_CAUSE, isCsrfRejection } from '../auth/csrf'
import { SessionUnconfirmedError, type SessionStore } from '../auth/session'
import { extractAuthContext } from '../graphql/errorRouting'
import { requestFailureMessage } from '../graphql/requestErrors'
import { FailurePanel } from '../ui/Failure'

// Only the server's answer counts (the httpOnly cookies are unreadable), and only on arrival:
// mid-session evictions are the Apollo error link's job.
export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context, location }) => {
    if ((await confirmSession(context.session)) === 'authenticated') {
      return
    }
    if (location.pathname === '/' && (await getSetupStatus()).setupComplete === false) {
      throw redirect({ to: '/setup-server' })
    }
    // The full href, so search params like a pairing code survive the round trip.
    throw redirect({ to: '/login', search: { redirect: location.href } })
  },
  pendingMs: 0,
  pendingComponent: CheckingSession,
  errorComponent: AuthenticatedLayoutFailure,
})

async function confirmSession(session: SessionStore) {
  try {
    return await session.ensure()
  } catch (cause) {
    throw new SessionUnconfirmedError(cause)
  }
}

function CheckingSession() {
  return (
    <Center h={200}>
      <Loader role="status" aria-label="Checking your account" />
    </Center>
  )
}

// A rejected probe is an outage, not a verdict: neither bounce nor waive the gate.
function AuthenticatedLayoutFailure({ error }: Readonly<{ error: unknown }>) {
  const router = useRouter()
  const apollo = useApolloClient()
  // A page that failed to render may have cached the response that broke it; remounting it would
  // read that response again, so the store refetches before the route runs again.
  const retry = async () => {
    await apollo.resetStore().catch(leaveFailuresToTheirQueries)
    await router.invalidate()
  }

  if (error instanceof ServerStatusUnavailableError) {
    return (
      <FailurePanel onRetry={retry} wayOut="sign-in">
        {error.message}
      </FailurePanel>
    )
  }

  return <FailurePanel onRetry={retry}>{entryFailureMessage(error)}</FailurePanel>
}

function leaveFailuresToTheirQueries() {
  // An active query that fails its refetch shows its own failure state.
}

function entryFailureMessage(error: unknown): string {
  if (!(error instanceof SessionUnconfirmedError)) {
    return "Couldn't load this page."
  }
  const context = extractAuthContext(error.cause)
  if (isCsrfRejection(context.networkStatus, context.networkCode)) {
    return CSRF_REJECTION_CAUSE
  }
  return requestFailureMessage(error.cause, error.message)
}
