import { Link, useLocation, useNavigate, useRouteContext } from '@tanstack/react-router'
import lockup from '../assets/streamarr-mark-and-text-light.svg'
import { useMe } from '../identity/useMe'
import { useLibraries } from '../media/useLibraries'
import { ProfileMenu } from './ProfileMenu'
import styles from './TopBar.module.css'

export function TopBar() {
  const { data } = useMe()
  // A library fetch failure degrades to Home-only chrome rather than an error banner: browsing
  // still works, and the nav pills are a convenience, not a page in their own right.
  const { data: librariesData } = useLibraries()
  const { session } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Chrome must never flash a half-known identity.
  if (!data) {
    return <header className={styles.topBar} aria-hidden />
  }

  return (
    <header className={styles.topBar}>
      <img className={styles.topBarLockup} src={lockup} alt="Streamarr" />
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
              search={{ by: 'ADDED', direction: 'DESC' }}
              className={pillClassName(pathname === to)}
            >
              {library.name ?? 'Library'}
            </Link>
          )
        })}
      </nav>
      <div className={styles.topBarTrail}>
        <ProfileMenu
          me={data.me}
          onPinRequired={(profileId) =>
            navigate({ to: '/select-profile', search: { profile: profileId } })
          }
          onSignedOut={() => navigate({ to: '/login' })}
          onUnauthenticated={() => {
            session.markAnonymous()
            navigate({ to: '/login' })
          }}
        />
      </div>
    </header>
  )
}

function pillClassName(active: boolean) {
  return active ? `${styles.navPill} ${styles.navPillActive}` : styles.navPill
}
