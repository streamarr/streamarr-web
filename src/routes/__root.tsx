import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router'
import type { SessionStore } from '../auth/session'
import type { FileRouteTypes } from '../routeTree.gen'
import { TopBar } from '../ui/TopBar'
import '../ui/auth.css'

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
  // Keyed off committed matches: _authenticated only commits once the server has vouched.
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
    <div className="homeShell">
      <div className="homeAmbient" aria-hidden />
      {signedIn && <TopBar />}
      <main className="homeContent">
        <Outlet />
      </main>
    </div>
  )
}
