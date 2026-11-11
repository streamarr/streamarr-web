import { useEffect, useState } from 'react'

// A timer waits at most this long; a longer wait would fire at once.
const LONGEST_WAIT = 2 ** 31 - 1

type Moments = readonly (string | null)[]

/**
 * The time now, read again as each of `moments` comes, so that a list that changes with the time,
 * such as offers that expire, changes on time with nothing else to make it. `moments` can depend
 * on the time it was last read, for what changes again and again as time passes. The timer stops
 * when the component unmounts.
 */
export function useNow(moments: Moments | ((now: Date) => Moments)): Date {
  const [now, setNow] = useState(() => new Date())
  const next = nextMoment(typeof moments === 'function' ? moments(now) : moments, now)

  useEffect(() => {
    if (next === null) return undefined
    const wait = Math.min(Math.max(next - Date.now(), 0), LONGEST_WAIT)
    const timer = setTimeout(() => setNow(new Date()), wait)
    return () => clearTimeout(timer)
  }, [next, now])

  return now
}

function nextMoment(moments: Moments, now: Date): number | null {
  const ahead = moments
    .flatMap((moment) => (moment === null ? [] : [Date.parse(moment)]))
    .filter((time) => time > now.getTime())
  return ahead.length > 0 ? Math.min(...ahead) : null
}
