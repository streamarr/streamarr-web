import { useNavigate } from '@tanstack/react-router'
import lockup from '../assets/streamarr-mark-and-text-light.svg'
import { useMe } from '../identity/useMe'
import { ProfileMenu } from './ProfileMenu'
import './auth.css'

// Frame 01's top bar: the lockup, a hairline, the nav pills, and the profile chip. Library
// pills and search land with their pages — a pill that goes nowhere teaches the feature might
// not exist. The bar renders nothing while me is in flight; chrome must never flash a
// half-known identity.
export function TopBar() {
  const { data } = useMe()
  const navigate = useNavigate()

  if (!data) {
    return <header className="topBar" aria-hidden />
  }

  return (
    <header className="topBar">
      <img className="topBarLockup" src={lockup} alt="Streamarr" />
      <div className="topBarDivider" aria-hidden />
      <nav className="topBarNav" aria-label="Primary">
        <span className="navPill navPillActive">Home</span>
      </nav>
      <div className="topBarTrail">
        <ProfileMenu
          me={data.me}
          onPinRequired={() => navigate({ to: '/select' })}
          onSignedOut={() => navigate({ to: '/login' })}
        />
      </div>
    </header>
  )
}
