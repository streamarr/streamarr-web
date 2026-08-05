import { AppShell, Title } from '@mantine/core'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import type { SessionStore } from '../auth/session'

interface RouterContext {
  session: SessionStore
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

function RootLayout() {
  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header px="md" style={{ display: 'flex', alignItems: 'center' }}>
        <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
          <Title order={3}>Streamarr</Title>
        </Link>
      </AppShell.Header>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  )
}
