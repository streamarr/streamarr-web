import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router'
import type { SessionStore } from '../auth/session'
import type { FileRouteTypes } from '../routeTree.gen'
import { AmbientScope } from '../media/AmbientScope'
import { AmbientThemeProvider, useAmbientTheme } from '../media/ambientThemeContext'
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

// Detail pages belong to the artwork (principle 1): the ambient page is the ground, with no
// neutral chrome or brand wash around it.
const AMBIENT_ROUTES = new Set<FileRouteTypes['id']>([
  '/_authenticated/movie/$movieId',
  '/_authenticated/series/$seriesId',
  '/_authenticated/season/$seasonId',
])

// Settings are neutral pages: the chrome stays, the browsing wash behind it does not.
const SETTINGS_ROUTES = new Set<FileRouteTypes['id']>(['/_authenticated/settings/server'])

function RootLayout() {
  return (
    <AmbientThemeProvider>
      <RootFrame />
    </AmbientThemeProvider>
  )
}

function RootFrame() {
  // 'success', not just present: the match exists (with a 'pending' status) the instant the path
  // matches, before beforeLoad's session probe has actually vouched for it — chrome mounted then
  // would fire its own queries against an unconfirmed session and race the guard's own redirect.
  const signedIn = useRouterState({
    select: (state) =>
      state.matches.some(
        (match) => match.routeId === '/_authenticated' && match.status === 'success',
      ),
  })
  const ceremony = useRouterState({
    select: (state) => state.matches.some((match) => CEREMONY_ROUTES.has(match.routeId)),
  })
  const ambient = useRouterState({
    select: (state) => state.matches.some((match) => AMBIENT_ROUTES.has(match.routeId)),
  })
  const theme = useAmbientTheme()
  const settings = useRouterState({
    select: (state) => state.matches.some((match) => SETTINGS_ROUTES.has(match.routeId)),
  })

  if (ceremony) {
    return <Outlet />
  }

  if (ambient) {
    return (
      <AmbientScope theme={theme}>
        {signedIn && <TopBar />}
        <Outlet />
      </AmbientScope>
    )
  }

  return (
    <HomeShell chrome={signedIn && <TopBar />} ambient={!settings}>
      <Outlet />
    </HomeShell>
  )
}
