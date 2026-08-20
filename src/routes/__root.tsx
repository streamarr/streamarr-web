import { AppShell, Button, Title } from '@mantine/core'
import {
  createRootRouteWithContext,
  Link,
  Outlet,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { useAuth } from '../auth/AuthProvider'
import type { SessionStore } from '../auth/session'

interface RouterContext {
  session: SessionStore
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

/**
 * Auth ceremonies render full-bleed on the bloom (mock frames 12-15a) — the wordmark in their
 * column is the brand, so the header would say it twice. Everything else keeps the app chrome.
 */
const CEREMONY_ROUTES = new Set([
  '/login',
  '/setup',
  '/reset',
  '/invite',
  '/_authenticated/select',
  '/_authenticated/link',
])

function RootLayout() {
  // Signed-in chrome keys off the committed route matches: the _authenticated layout only
  // commits once the guard has the server's word, so this cannot show sign-out to a visitor
  // whose session was never vouched for.
  const signedIn = useRouterState({
    select: (state) => state.matches.some((match) => match.routeId === '/_authenticated'),
  })
  const ceremony = useRouterState({
    select: (state) => state.matches.some((match) => CEREMONY_ROUTES.has(match.routeId)),
  })

  if (ceremony) {
    return <Outlet />
  }

  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header px="md" style={{ display: 'flex', alignItems: 'center' }}>
        <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
          <Title order={3}>Streamarr</Title>
        </Link>
        {signedIn ? <SignOutButton /> : null}
      </AppShell.Header>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  )
}

function SignOutButton() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  function onSignOut() {
    // Local state ends immediately. Server revocation remains best-effort so an outage cannot
    // trap the visitor in a session they explicitly left.
    void logout().catch(() => {})
    void navigate({ to: '/login' })
  }

  return (
    <Button variant="subtle" style={{ marginLeft: 'auto' }} onClick={onSignOut}>
      Sign out
    </Button>
  )
}
