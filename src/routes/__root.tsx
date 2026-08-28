import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router'
import type { SessionStore } from '../auth/session'
import { TopBar } from '../ui/TopBar'
import '../ui/auth.css'

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
  '/_authenticated/select-profile',
  '/_authenticated/link',
])

function RootLayout() {
  // Signed-in chrome keys off the committed route matches: the _authenticated layout only
  // commits once the guard has the server's word, so this cannot show the top bar to a visitor
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

  // Frame 01's chrome: the ambient wash over the ground, the top bar riding it, and the page
  // below — no boxed shell around the content.
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
