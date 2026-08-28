import { Alert, Center, Loader } from '@mantine/core'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { CSRF_REJECTION_MESSAGE, isCsrfRejection } from '../auth/csrf'
import { extractAuthContext } from '../graphql/errorRouting'

// The gate for every signed-in page: routes nested under this layout render only once the
// server has vouched for the session (the client cannot read the httpOnly cookies, so only the
// server's answer counts). New routes are protected by default by living in _authenticated/;
// being public — /login, /setup — is the explicit choice. Mid-session evictions stay the Apollo
// error link's job; this guard only covers arrival.
export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context, location }) => {
    if ((await context.session.ensure()) === 'anonymous') {
      // The full href, so search params (like a pairing code) survive the round trip.
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

// The probe rejected: an outage, not a verdict. Bouncing to sign-in would gaslight a visitor
// whose session may be fine, and rendering the page would waive the gate — so fail closed. A
// CSRF-specific rejection gets its own actionable message; every page under this gate inherits
// it instead of each page re-deriving it from its own query error.
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
