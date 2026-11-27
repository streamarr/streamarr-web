import type { ReactNode } from 'react'
import type { SharedProfileFieldsFragment } from '../graphql/generated/graphql'
import { RowAvatar } from '../ui/ProfileTile'
import styles from './Sharing.module.css'

/**
 * A Profile that a share brings into the Household, as its row shows it: its mark, its name, who
 * brought it, and the facts that are true of it. `children` adds facts of the share itself.
 */
export function SharedProfileText({
  profile,
  byline,
  children,
}: Readonly<{
  profile: SharedProfileFieldsFragment
  /** Who offered or shared the Profile, or null when the server names no one. */
  byline: string | null
  children?: ReactNode
}>) {
  return (
    <span className={styles.rowProfile}>
      <RowAvatar profile={profile} />
      <span className={styles.rowText}>
        {profile.name}
        {byline && <span className={styles.status}>{byline}</span>}
        {profile.personalProfile && <span className={styles.status}>Personal Profile</span>}
        {profile.restricted && <span className={styles.status}>Restricted</span>}
        {children}
      </span>
    </span>
  )
}
