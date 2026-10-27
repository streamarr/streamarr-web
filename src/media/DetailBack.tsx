import type { MouseEvent, ReactNode } from 'react'
import {
  Link,
  useLocation,
  useNavigate,
  useRouter,
  type HistoryState,
} from '@tanstack/react-router'
import styles from './DetailBack.module.css'
import { Icon } from '../ui/Icon'

declare module '@tanstack/react-router' {
  interface HistoryState {
    seriesEntry?: { seriesId: string; index: number }
  }
}

// Returns to wherever the page was opened from; a deep link with no history lands on Home.
export function DetailBackButton() {
  const router = useRouter()
  const navigate = useNavigate()

  function goBack() {
    if (router.history.length > 1) {
      router.history.back()
      return
    }
    void navigate({ to: '/' })
  }

  return (
    <button type="button" className={styles.back} onClick={goBack}>
      <Icon name="arrow-left" size={16} />
      Back
    </button>
  )
}

/** History state for a link from a series to one of its seasons, so the season can return to this entry. */
export function useSeriesEntryState(seriesId: string): HistoryState {
  const index = useLocation({ select: (location) => location.state.__TSR_index })
  return { seriesEntry: { seriesId, index } }
}

/** Carries the series entry across a switch between a series' seasons. */
export function keepSeriesEntry(state: HistoryState): HistoryState {
  return { seriesEntry: state.seriesEntry }
}

// The series page's Back leaves through history, so a season must never stack the series above
// itself: it returns to the series entry it was opened from, or replaces itself with the series.
export function SeriesReturnLink({
  seriesId,
  children,
}: Readonly<{ seriesId: string; children: ReactNode }>) {
  const router = useRouter()
  const state = useLocation({ select: (location) => location.state })

  function returnToSeriesEntry(event: MouseEvent<HTMLAnchorElement>) {
    const entry = state.seriesEntry
    if (entry?.seriesId !== seriesId || opensElsewhere(event)) {
      return
    }
    event.preventDefault()
    router.history.go(entry.index - state.__TSR_index)
  }

  return (
    <Link
      to="/series/$seriesId"
      params={{ seriesId }}
      replace
      className={styles.back}
      onClick={returnToSeriesEntry}
    >
      <Icon name="arrow-left" size={16} />
      {children}
    </Link>
  )
}

function opensElsewhere(event: MouseEvent) {
  return event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey
}
