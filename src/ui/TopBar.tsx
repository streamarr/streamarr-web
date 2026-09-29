import { Link, useLocation, useNavigate, useRouteContext } from '@tanstack/react-router'
import { useSignOut } from '../auth/useSignOut'
import { useMe } from '../identity/useMe'
import { useLibraries } from '../media/useLibraries'
import { Lockup } from './Lockup'
import { ProfileMenu } from './ProfileMenu'
import styles from './TopBar.module.css'

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
  const { session } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate()
  const signOut = useSignOut(() => void navigate({ to: '/login' }))

  if (data) {
    return (
      <ProfileMenu
        me={data.me}
        onServerSettings={() => navigate({ to: '/settings/server/libraries' })}
        onPinRequired={(profileId) =>
          navigate({ to: '/select-profile', search: { profile: profileId } })
        }
        onSignedOut={() => navigate({ to: '/login' })}
        onUnauthenticated={() => {
          session.markAnonymous()
          void navigate({ to: '/login' })
        }}
      />
    )
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

function pillClassName(active: boolean) {
  return active ? `${styles.navPill} ${styles.navPillActive}` : styles.navPill
}
