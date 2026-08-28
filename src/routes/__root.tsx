import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router'
import type { SessionStore } from '../auth/session'
import type { FileRouteTypes } from '../routeTree.gen'
import { HomeShell } from '../ui/HomeShell'
import { TopBar } from '../ui/TopBar'

interface RouterContext {
  session: SessionStore
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

// Ceremonies render full-bleed; their column carries the wordmark, so the header would repeat it.
const CEREMONY_ROUTES = new Set<FileRouteTypes['id']>([
  '/login',
  '/setup-server',
  '/reset',
  '/invite',
  '/_authenticated/select-profile',
  '/_authenticated/link',
])

function RootLayout() {
  // 'success', not just present: the match exists (with a 'pending' status) the instant the path
  // matches, before beforeLoad's session probe has actually vouched for it — chrome mounted then
  // would fire its own queries against an unconfirmed session and race the guard's own redirect.
  const signedIn = useRouterState({
    select: (state) =>
      state.matches.some((match) => match.routeId === '/_authenticated' && match.status === 'success'),
  })
  const ceremony = useRouterState({
    select: (state) => state.matches.some((match) => CEREMONY_ROUTES.has(match.routeId)),
  })

  if (ceremony) {
    return <Outlet />
  }

  return (
    <HomeShell chrome={signedIn && <TopBar />}>
      <Outlet />
    </HomeShell>
  )
}
