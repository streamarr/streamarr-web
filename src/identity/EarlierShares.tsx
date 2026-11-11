import { useId, useState } from 'react'
import { Icon } from '../ui/Icon'
import { enumLabel } from './enumLabel'
import styles from './Sharing.module.css'
import type { ProfileShareRow } from './WhereShared'

const DAY = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })

/**
 * The offers and shares of a Profile that are over, closed until asked for: they say what
 * happened, and nothing can be done with them.
 */
export function EarlierShares({
  shares,
  householdName,
}: Readonly<{
  shares: readonly ProfileShareRow[]
  householdName: (householdId: string) => string
}>) {
  const [open, setOpen] = useState(false)
  const listId = useId()

  if (shares.length === 0) return null

  return (
    <div className={styles.earlier}>
      <button
        type="button"
        className={styles.disclosure}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen(!open)}
      >
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
        Earlier offers and shares
      </button>
      {open && (
        <ul id={listId} className={styles.rows}>
          {shares.map((share) => (
            <li key={share.id} className={styles.row}>
              <span className={styles.rowText}>
                {householdName(share.householdId)}
                <span className={styles.status}>{outcome(share)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** What became of an offer or a share that is over. */
function outcome(share: ProfileShareRow): string {
  switch (share.status) {
    case 'REJECTED':
      return 'Declined'
    case 'ENDED':
      return share.endedAt ? `Ended ${DAY.format(new Date(share.endedAt))}` : 'Ended'
    case 'INVALIDATED':
      return share.invalidationReason ? `Withdrawn: ${share.invalidationReason}` : 'Withdrawn'
    default:
      return enumLabel(share.status)
  }
}
