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

function RootLayout() {
  // Signed-in chrome keys off the committed route matches: the _authenticated layout only
  // commits once the guard has the server's word, so this cannot show sign-out to a visitor
  // whose session was never vouched for.
  const signedIn = useRouterState({
    select: (state) => state.matches.some((match) => match.routeId === '/_authenticated'),
  })

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
