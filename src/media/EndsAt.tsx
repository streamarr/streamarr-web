import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import styles from './EndsAt.module.css'

/** When a title would finish if played now, kept current as the minutes pass. */
export function EndsAt({ remainingSeconds }: Readonly<{ remainingSeconds: number }>) {
  // A new time left starts a new clock, so the end time never counts from a time already past.
  return <EndTime key={remainingSeconds} remainingMs={remainingSeconds * 1000} />
}

function EndTime({ remainingMs }: Readonly<{ remainingMs: number }>) {
  const now = useEndMinuteClock(remainingMs)
  const end = new Date(now + remainingMs)
  return (
    <span className={styles.endsAt}>
      <Icon name="ends-at" size={16} label="Ends at" />
      <span className={styles.time}>
        {end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
      </span>
    </span>
  )
}

// The current time, refreshed each time the end time reaches a new minute, which falls between
// the clock's own minutes when the time left has seconds, so the end time shown never lags. The
// next refresh counts from the time the end was drawn with, so a minute that turns before the
// effect starts refreshes at once.
function useEndMinuteClock(remainingMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const drawnEnd = now + remainingMs
    const nextMinute = drawnEnd - (drawnEnd % MINUTE) + MINUTE
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, nextMinute - remainingMs - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [now, remainingMs])
  return now
}

const MINUTE = 60_000
