const UNITS = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
] as const

/** How long ago a time within this reach reads; anything earlier reads as its date. */
const RECENT = 7 * 86_400_000

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'always' })
const date = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })
const full = new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short' })

/**
 * When something happened, as a row says it: how long ago within the last week, to the whole unit
 * that has passed ("3 hours ago"), and its date before that ("Nov 3, 2026").
 */
export function whenLabel(at: string, now: Date): string {
  const time = new Date(at)
  const ago = now.getTime() - time.getTime()
  if (ago >= RECENT) return date.format(time)
  const unit = UNITS.find(([, size]) => ago >= size)
  if (!unit) return 'Just now'
  const [name, size] = unit
  return relative.format(-Math.floor(ago / size), name)
}

/**
 * When the label of something that happened at `at` next changes after `now`: once the next whole
 * unit has passed, or once it turns into the date. Null once it already says the date.
 */
export function nextLabelChange(at: string, now: Date): string | null {
  const time = new Date(at).getTime()
  const ago = now.getTime() - time
  if (ago >= RECENT) return null
  const [, size] = UNITS.find(([, unit]) => ago >= unit) ?? UNITS[UNITS.length - 1]
  const next = time + (Math.floor(Math.max(ago, 0) / size) + 1) * size
  return new Date(Math.min(next, time + RECENT)).toISOString()
}

/** The day, date and time something happened, in the reader's time zone. */
export function fullTime(at: string): string {
  return full.format(new Date(at))
}
