import { Center, Loader } from '@mantine/core'
import { useId } from 'react'
import { FailureRow } from '../ui/Failure'
import { Icon } from '../ui/Icon'
import { enumLabel } from './enumLabel'
import styles from './Sharing.module.css'
import type { ProfileShareRow } from './WhereShared'

const DAY = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })

/**
 * The offers and shares of a Profile that are over, closed until asked for, and read when first
 * asked for: they say what happened, and nothing can be done with them.
 */
export function EarlierShares({
  open,
  onToggle,
  shares,
  loading,
  failure,
  onRetry,
  householdName,
}: Readonly<{
  open: boolean
  onToggle: () => void
  shares: readonly ProfileShareRow[]
  /** Whether the first read of them is on its way. */
  loading: boolean
  /** Why they could not be read, or null. */
  failure: string | null
  onRetry: () => unknown
  householdName: (householdId: string) => string
}>) {
  const listId = useId()

  return (
    <div className={styles.earlier}>
      <button
        type="button"
        className={styles.disclosure}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={onToggle}
      >
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
        Earlier invitations and shares
      </button>
      {open && (
        <EarlierList
          id={listId}
          shares={shares}
          loading={loading}
          failure={failure}
          onRetry={onRetry}
          householdName={householdName}
        />
      )}
    </div>
  )
}

function EarlierList({
  id,
  shares,
  loading,
  failure,
  onRetry,
  householdName,
}: Readonly<{
  id: string
  shares: readonly ProfileShareRow[]
  loading: boolean
  failure: string | null
  onRetry: () => unknown
  householdName: (householdId: string) => string
}>) {
  if (failure && shares.length === 0) {
    return (
      <div id={id}>
        <FailureRow onRetry={onRetry}>{failure}</FailureRow>
      </div>
    )
  }
  if (loading && shares.length === 0) {
    return (
      <Center id={id} h={80}>
        <Loader role="status" aria-label="Loading earlier offers and shares" />
      </Center>
    )
  }
  if (shares.length === 0) {
    return (
      <p id={id} className={styles.note}>
        No earlier offers or shares.
      </p>
    )
  }
  return (
    <ul id={id} className={styles.rows}>
      {shares.map((share) => (
        <li key={share.id} className={styles.row}>
          <span className={styles.rowText}>
            {householdName(share.householdId)}
            <span className={styles.status}>{outcome(share)}</span>
          </span>
        </li>
      ))}
    </ul>
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
