import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import styles from './EndsAt.module.css'

/** When a title would finish if played now, kept current as the minutes pass. */
export function EndsAt({ remainingSeconds }: Readonly<{ remainingSeconds: number }>) {
  const now = useMinuteClock()
  const end = new Date(now.getTime() + remainingSeconds * 1000)
  return (
    <span className={styles.endsAt}>
      <Icon name="ends-at" size={16} label="Ends at" />
      <span className={styles.time}>
        {end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
      </span>
    </span>
  )
}

// The current time, refreshed on each minute boundary so an end time never lags the clock.
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(
        () => {
          setNow(new Date())
          schedule()
        },
        MINUTE - (Date.now() % MINUTE),
      )
    }
    schedule()
    return () => clearTimeout(timer)
  }, [])
  return now
}

const MINUTE = 60_000
