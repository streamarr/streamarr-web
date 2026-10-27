import { useApolloClient } from '@apollo/client/react'
import { Center, Loader } from '@mantine/core'
import { createFileRoute, Outlet, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { getSetupStatus, ServerStatusUnavailableError } from '../auth/api'
import { CSRF_REJECTION_CAUSE, isCsrfRejection } from '../auth/csrf'
import { SessionUnconfirmedError, type SessionStore } from '../auth/session'
import { extractAuthContext } from '../graphql/errorRouting'
import { requestFailureMessage } from '../graphql/requestErrors'
import { readActiveQueriesAgain } from '../graphql/readAgain'
import { installRevalidation } from '../graphql/revalidation'
import { canManageServer } from '../admin/access'
import { useMe } from '../identity/useMe'
import {
  subscribeToAdministeredLibraryChanges,
  subscribeToLibraryChanges,
} from '../media/libraryChanges'
import { subscribeToWatchStateChanges } from '../media/watchStateChanges'
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
  component: Authenticated,
})

async function confirmSession(session: SessionStore) {
  try {
    return await session.ensure()
  } catch (cause) {
    throw new SessionUnconfirmedError(cause)
  }
}

// Live changes keep a signed-in page current; a revalidation covers any gap they may have left.
function Authenticated() {
  const client = useApolloClient()
  const { subscriptions } = Route.useRouteContext()
  useEffect(
    () =>
      installRevalidation({
        // Every read settles first: a refetch that joined a still-pending read would share it.
        refetchActive: () => readActiveQueriesAgain(client),
        isReading: () =>
          [...client.getObservableQueries('active')].some(
            (query) => query.getCurrentResult().loading,
          ),
        onMissedChanges: (listener) => subscriptions.onMissedChanges(listener),
        window,
        document,
      }),
    [client, subscriptions],
  )
  // Watch state belongs to a Profile, and Library changes require one, so the changes follow
  // whichever Profile is selected. A store reset refetches the selection, and the earlier value
  // holds until the next one arrives. Library status changes reach only a session that may
  // administer the server. A remount subscribes again to the same documents and joins their live
  // operations, but a change of capability replaces them with other documents, which miss the
  // changes committed in between, so the active queries read again once those subscribe.
  const me = useMe()
  const current = (me.data ?? me.previousData)?.me
  const profileId = current?.selectedProfile?.id
  const administers = canManageServer(current)
  const subscribedAsAdministrator = useRef<boolean | null>(null)
  useEffect(() => {
    if (!profileId) return undefined
    const stops = [
      subscribeToWatchStateChanges(client),
      administers
        ? subscribeToAdministeredLibraryChanges(client)
        : subscribeToLibraryChanges(client),
    ]
    const previous = subscribedAsAdministrator.current
    subscribedAsAdministrator.current = administers
    if (previous !== null && previous !== administers)
      subscriptions.reportMissedChangesOnceSubscribed()
    return () => stops.forEach((stop) => stop())
  }, [client, profileId, administers, subscriptions])
  return <Outlet />
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
