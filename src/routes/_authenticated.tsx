import { Alert, Center, Loader } from '@mantine/core'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { CSRF_REJECTION_MESSAGE, isCsrfRejection } from '../auth/csrf'
import { extractAuthContext } from '../graphql/errorRouting'

// Only the server's answer counts (the httpOnly cookies are unreadable), and only on arrival:
// mid-session evictions are the Apollo error link's job.
export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context, location }) => {
    if ((await context.session.ensure()) === 'anonymous') {
      // The full href, so search params like a pairing code survive the round trip.
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
  pendingMs: 0,
  pendingComponent: CheckingSession,
  errorComponent: SessionUnconfirmed,
})

function CheckingSession() {
  return (
    <Center h={200}>
      <Loader role="status" aria-label="Checking your account" />
    </Center>
  )
}

// A rejected probe is an outage, not a verdict: neither bounce nor waive the gate.
function SessionUnconfirmed({ error }: { error: unknown }) {
  const context = extractAuthContext(error)
  const message = isCsrfRejection(context.networkStatus, context.networkCode)
    ? CSRF_REJECTION_MESSAGE
    : "Couldn't confirm you're signed in. Reload the page to try again."
  return (
    <Alert color="red" role="alert">
      {message}
    </Alert>
  )
}
