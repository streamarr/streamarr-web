import { useApolloClient } from '@apollo/client/react'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import type { MeQuery } from '../graphql/generated/graphql'
import { initials, tileColor } from './ProfileTile'
import './auth.css'

type Me = MeQuery['me']
type SelectableProfile = Me['selectableProfiles']['edges'][number]['node']

// Frame 01a: the profile menu under the top bar's avatar chip. The current profile leads with
// its role; the Household's other profiles follow — a PIN-protected one detours through the
// full gate, a safety-locked one is visible but not selectable (principle 7.2) — and sign out
// closes the panel. Settings lands with a settings page; a dead row would teach the feature
// might not exist.
export function ProfileMenu({
  me,
  onPinRequired,
  onSignedOut,
}: {
  me: Me
  onPinRequired: (profileId: string) => void
  onSignedOut: () => void
}) {
  const { selectProfile, logout } = useAuth()
  const client = useApolloClient()
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!opened) {
      return
    }
    function onPointerDown(event: MouseEvent) {
      if (anchor.current && !anchor.current.contains(event.target as Node)) {
        setOpened(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpened(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [opened])

  const profiles = me.selectableProfiles.edges.map((edge) => edge.node)
  const current = profiles.find((profile) => profile.selected)
  const chipName = current?.name ?? me.displayName

  async function switchTo(profile: SelectableProfile) {
    if (profile.pinConfigured) {
      setOpened(false)
      onPinRequired(profile.id)
      return
    }
    setBusy(true)
    try {
      await selectProfile(profile.id)
      // A different profile is a different identity: nothing cached may survive it.
      await client.resetStore()
      setOpened(false)
    } finally {
      setBusy(false)
    }
  }

  function signOut() {
    setOpened(false)
    // Local state ends immediately; server revocation stays best-effort — an outage must never
    // trap someone in a session they explicitly left.
    void logout().catch(() => {})
    onSignedOut()
  }

  return (
    <div className="profileMenuAnchor" ref={anchor}>
      <button
        type="button"
        className={`profileChip${opened ? ' profileChipOpen' : ''}`}
        aria-label={`Profile menu (${chipName})`}
        aria-haspopup="menu"
        aria-expanded={opened}
        onClick={() => setOpened((open) => !open)}
      >
        {initials(chipName)}
      </button>
      {opened && (
        <div className="profileMenu" role="menu">
        {profiles.map((profile, index) => (
          <button
            key={profile.id}
            type="button"
            className={`profileMenuRow${profile.selected ? ' profileMenuRowCurrent' : ''}`}
            disabled={busy || profile.locked || profile.selected}
            aria-label={rowLabel(profile)}
            onClick={() => switchTo(profile)}
          >
            <span className="profileMenuAvatar" style={{ background: tileColor(index) }}>
              {initials(profile.name)}
            </span>
            <span className="profileMenuName">
              <span>{profile.name}</span>
              {profile.selected && roleLabel(me) && (
                <span className="profileMenuRole">{roleLabel(me)}</span>
              )}
            </span>
            {profile.selected && <CheckGlyph />}
          </button>
        ))}
          <div className="profileMenuDivider" aria-hidden />
          <button type="button" className="profileMenuRow" onClick={signOut}>
            <SignOutGlyph />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  )
}

function rowLabel(profile: SelectableProfile) {
  if (profile.locked) return `${profile.name} (locked)`
  if (profile.pinConfigured) return `${profile.name} (PIN protected)`
  return profile.name
}

function roleLabel(me: Me): string | null {
  if (me.serverAdmin) return 'Server owner'
  if (me.householdRole === 'ADMIN') return 'Household admin'
  return null
}

function CheckGlyph() {
  return (
    <svg
      className="profileMenuCheck"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

function SignOutGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}
