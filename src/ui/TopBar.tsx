import { Link, useLocation, useNavigate, useRouteContext } from '@tanstack/react-router'
import { useSignOut } from '../auth/useSignOut'
import type { MeQuery } from '../graphql/generated/graphql'
import { useMe } from '../identity/useMe'
import { useLibraries } from '../media/useLibraries'
import { Lockup } from './Lockup'
import { useMenuCounts } from './MenuCountsProvider'
import { ProfileMenu } from './ProfileMenu'
import styles from './TopBar.module.css'

type Me = MeQuery['me']

export function TopBar() {
  // A library fetch failure degrades to Home-only chrome rather than an error banner: browsing
  // still works, and the nav pills are a convenience, not a page in their own right.
  const { data: librariesData } = useLibraries()
  const { pathname } = useLocation()

  return (
    <header className={styles.topBar}>
      <Lockup className={styles.topBarLockup} />
      <div className={styles.topBarDivider} aria-hidden />
      <nav className={styles.topBarNav} aria-label="Primary">
        <Link to="/" className={pillClassName(pathname === '/')}>
          Home
        </Link>
        {librariesData?.libraries.map((library) => {
          const to = `/library/${library.id}`
          return (
            <Link
              key={library.id}
              to="/library/$libraryId"
              params={{ libraryId: library.id }}
              search={{ by: 'TITLE', direction: 'ASC' }}
              className={pillClassName(pathname === to)}
            >
              {library.name ?? 'Library'}
            </Link>
          )
        })}
      </nav>
      <div className={styles.topBarTrail}>
        <AccountTrail />
      </div>
    </header>
  )
}

// Chrome must never flash a half-known identity, and an account that failed to load must still
// leave a way out.
function AccountTrail() {
  const { data, error } = useMe()
  const navigate = useNavigate()
  const toSignIn = () => void navigate({ to: '/login' })
  const signOut = useSignOut(toSignIn)

  if (data) {
    return <AccountMenu me={data.me} toSignIn={toSignIn} />
  }

  if (error) {
    return (
      <button type="button" className={styles.navPill} onClick={signOut}>
        Sign out
      </button>
    )
  }

  return null
}

/** The Profile menu of a known identity, with the places it opens. */
function AccountMenu({ me, toSignIn }: Readonly<{ me: Me; toSignIn: () => void }>) {
  const { session } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate()
  const { unreadNotifications } = useMenuCounts()

  return (
    <ProfileMenu
      me={me}
      unreadNotifications={unreadNotifications}
      onServerSettings={() => navigate({ to: '/settings/server/libraries' })}
      onProfileSettings={() => navigate({ to: '/settings/profile/languages' })}
      onHouseholdSettings={() => navigate({ to: '/settings/household/offers' })}
      onNotifications={() => navigate({ to: '/notifications' })}
      onPinRequired={(profileId) =>
        navigate({ to: '/select-profile', search: { profile: profileId } })
      }
      onSignedOut={toSignIn}
      onUnauthenticated={() => {
        session.markAnonymous()
        toSignIn()
      }}
    />
  )
}

function pillClassName(active: boolean) {
  return active ? `${styles.navPill} ${styles.navPillActive}` : styles.navPill
}
