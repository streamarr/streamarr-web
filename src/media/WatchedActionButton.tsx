import { Icon } from '../ui/Icon'
import { detailAction } from './DetailHeader'

/** Shared watched-state action; callers own the mutation and any bulk confirmation. */
export function WatchedActionButton({
  isWatched,
  pending,
  subject,
  onClick,
}: Readonly<{
  /** Whether the entire media item is currently watched. */
  isWatched: boolean
  /** Disables repeat submissions while a mutation is in flight. */
  pending: boolean
  /** Names the bulk scope; omitted for an individual movie. */
  subject?: 'series' | 'season'
  /** Requests the action; bulk callers must confirm before mutating watched state. */
  onClick: () => void
}>) {
  const nextState = isWatched ? 'unwatched' : 'watched'
  const label = subject ? `Mark ${subject} ${nextState}` : `Mark ${nextState}`
  return (
    <button type="button" className={detailAction.outline} disabled={pending} onClick={onClick}>
      <Icon name="watched-action" size={16} />
      {label}
    </button>
  )
}
