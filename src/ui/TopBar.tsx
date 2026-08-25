import { useNavigate, useRouteContext } from '@tanstack/react-router'
import lockup from '../assets/streamarr-mark-and-text-light.svg'
import { useMe } from '../identity/useMe'
import { ProfileMenu } from './ProfileMenu'
import styles from './TopBar.module.css'

export function TopBar() {
  const { data } = useMe()
  const { session } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate()

  // Chrome must never flash a half-known identity.
  if (!data) {
    return <header className={styles.topBar} aria-hidden />
  }

  return (
    <header className={styles.topBar}>
      <img className={styles.topBarLockup} src={lockup} alt="Streamarr" />
      <div className={styles.topBarDivider} aria-hidden />
      <nav className={styles.topBarNav} aria-label="Primary">
        <span className={`${styles.navPill} ${styles.navPillActive}`}>Home</span>
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
