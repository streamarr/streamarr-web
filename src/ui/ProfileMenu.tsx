import { useEffect, useId, useRef, useState } from 'react'
import { AuthApiError } from '../auth/api'
import { useAuth } from '../auth/AuthProvider'
import { useSignOut } from '../auth/useSignOut'
import type { MeQuery } from '../graphql/generated/graphql'
import { initials, tileColor } from './ProfileTile'
import { countText } from './countText'
import { Icon, type IconName } from './Icon'
import { UnreadCount } from './UnreadCount'
import { UnreadDot } from './UnreadDot'
import { canManageServer } from '../admin/access'
import { canManageHousehold } from '../identity/householdAccess'
import { canReadNotifications } from '../notifications/notificationAccess'
import styles from './ProfileMenu.module.css'

type Me = MeQuery['me']
type SelectableProfile = Me['selectableProfiles']['edges'][number]['node']

const SESSION_EVICTION_CODES = new Set([
  'AUTHENTICATION_REQUIRED',
  'EXPIRED_TOKEN',
  'INVALID_TOKEN',
])
const SWITCH_FAILED_MESSAGE = "Couldn't switch profiles."

export function ProfileMenu({
  me,
  onPinRequired,
  onSignedOut,
  onUnauthenticated,
  onServerSettings,
  onProfileSettings,
  onHouseholdSettings,
  onNotifications,
  unreadNotifications = 0,
  waitingOffers = 0,
}: Readonly<{
  me: Me
  onPinRequired: (profileId: string) => void
  onSignedOut: () => void
  onUnauthenticated: () => void
  /** Opens the integrated settings route; only exposed for eligible account sessions. */
  onServerSettings?: () => void
  /** Opens the selected Profile's settings; offered only while a Profile is selected. */
  onProfileSettings?: () => void
  /** Opens the Household's settings; offered only to its admins in an account session. */
  onHouseholdSettings?: () => void
  /** Opens the Account's Notifications; offered in any account session. */
  onNotifications?: () => void
  /** How many of the Account's Notifications are unread, counted after their entry. */
  unreadNotifications?: number
  /** How many offers wait for the Household's decision, counted after Household settings. */
  waitingOffers?: number
}>) {
  const { selectProfile } = useAuth()
  const signOut = useSignOut(onSignedOut)
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const chip = useRef<HTMLButtonElement>(null)
  const panelId = useId()

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
        close()
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
  // The entries the session may use, and so the counts the menu shows.
  const householdSettings = canManageHousehold(me) ? onHouseholdSettings : undefined
  const notifications = canReadNotifications(me) ? onNotifications : undefined
  const hasCount =
    (householdSettings !== undefined && waitingOffers > 0) ||
    (notifications !== undefined && unreadNotifications > 0)

  // Closing from inside the panel (Escape, a choice) must not drop focus on <body>.
  function close() {
    setOpened(false)
    chip.current?.focus()
  }

  async function switchTo(profile: SelectableProfile) {
    if (profile.pinConfigured) {
      close()
      onPinRequired(profile.id)
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      await selectProfile(profile.id)
      close()
    } catch (error) {
      reportSwitchFailure(error)
    } finally {
      setBusy(false)
    }
  }

  // REST errors bypass the Apollo error link, so a session-level 401 is routed from here.
  function reportSwitchFailure(error: unknown) {
    if (isSessionEviction(error)) {
      close()
      onUnauthenticated()
      return
    }
    setFailure(switchFailureMessage(error))
  }

  function toggle() {
    setFailure(null)
    setOpened((open) => !open)
  }

  // An entry's choice closes the menu before it acts.
  function closeThen(choose: () => void) {
    return () => {
      close()
      choose()
    }
  }

  return (
    <div className={styles.profileMenuAnchor} ref={anchor}>
      <button
        ref={chip}
        type="button"
        className={opened ? `${styles.profileChip} ${styles.profileChipOpen}` : styles.profileChip}
        aria-label={`Profile menu (${chipName})${hasCount ? ', has notifications' : ''}`}
        aria-expanded={opened}
        aria-controls={opened ? panelId : undefined}
        onClick={toggle}
      >
        {initials(chipName)}
        {hasCount && <UnreadDot />}
      </button>
      {opened && (
        <span className={styles.profileMenuNotch} data-testid="profile-menu-notch" aria-hidden />
      )}
      {opened && (
        <div id={panelId} className={styles.profileMenu} data-testid="profile-menu">
          {profiles.map((profile, index) => (
            <button
              key={profile.id}
              type="button"
              className={
                profile.selected
                  ? `${styles.profileMenuRow} ${styles.profileMenuRowCurrent}`
                  : styles.profileMenuRow
              }
              disabled={busy || profile.locked || profile.selected}
              aria-label={rowLabel(profile)}
              onClick={() => switchTo(profile)}
            >
              <span className={styles.profileMenuAvatar} style={{ background: tileColor(index) }}>
                {initials(profile.name)}
              </span>
              <span className={styles.profileMenuName}>
                <span className={styles.profileMenuLabel}>{profile.name}</span>
                {profile.selected && roleLabel(me) && (
                  <span className={styles.profileMenuRole}>{roleLabel(me)}</span>
                )}
              </span>
              {profile.selected && (
                <Icon name="check" size={16} className={styles.profileMenuCheck} />
              )}
            </button>
          ))}
          {failure && (
            <div className={styles.profileMenuError} role="alert">
              {failure}
            </div>
          )}
          <div className={styles.profileMenuDivider} aria-hidden />
          {me.selectedProfile && onProfileSettings && (
            <MenuEntry
              icon="settings"
              label="Profile settings"
              onChoose={closeThen(onProfileSettings)}
            />
          )}
          {householdSettings && (
            <MenuEntry
              icon="settings"
              label="Household settings"
              count={{ value: waitingOffers, words: offersWaiting }}
              onChoose={closeThen(householdSettings)}
            />
          )}
          {canManageServer(me) && onServerSettings && (
            <MenuEntry
              icon="settings"
              label="Server settings"
              onChoose={closeThen(onServerSettings)}
            />
          )}
          {notifications && (
            <MenuEntry
              icon="notifications"
              label="Notifications"
              count={{ value: unreadNotifications, words: (text) => `${text} unread` }}
              onChoose={closeThen(notifications)}
            />
          )}
          <MenuEntry icon="sign-out" label="Sign out" onChoose={closeThen(signOut)} />
        </div>
      )}
    </div>
  )
}

/** A count after an entry's label, and how the entry's accessible name says it. */
interface EntryCount {
  value: number
  words: (text: string) => string
}

function MenuEntry({
  icon,
  label,
  count,
  onChoose,
}: Readonly<{ icon: IconName; label: string; count?: EntryCount; onChoose: () => void }>) {
  const text = countText(count?.value ?? 0)
  const name = text && count ? `${label}, ${count.words(text)}` : undefined
  return (
    <button type="button" className={styles.profileMenuRow} aria-label={name} onClick={onChoose}>
      <Icon name={icon} size={20} />
      <span>{label}</span>
      {text && <UnreadCount text={text} />}
    </button>
  )
}

function offersWaiting(text: string): string {
  return text === '1' ? '1 offer waiting' : `${text} offers waiting`
}

function isSessionEviction(error: unknown): boolean {
  return (
    error instanceof AuthApiError &&
    error.status === 401 &&
    error.code !== null &&
    SESSION_EVICTION_CODES.has(error.code)
  )
}

function switchFailureMessage(error: unknown): string {
  if (error instanceof AuthApiError && error.serverMessage) {
    return error.serverMessage
  }
  return SWITCH_FAILED_MESSAGE
}

function rowLabel(profile: SelectableProfile) {
  if (profile.locked) return `${profile.name} (locked)`
  if (profile.pinConfigured) return `${profile.name} (PIN protected)`
  return profile.name
}

function roleLabel(me: Me): string | null {
  if (me.serverAdmin) return 'Server admin'
  if (me.householdRole === 'ADMIN') return 'Household admin'
  return null
}
