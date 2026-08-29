const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const elapsedSeconds = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000)

  if (elapsedSeconds < MINUTE) return 'just now'
  if (elapsedSeconds < HOUR) return plural(Math.floor(elapsedSeconds / MINUTE), 'minute')
  if (elapsedSeconds < DAY) return plural(Math.floor(elapsedSeconds / HOUR), 'hour')
  if (elapsedSeconds < WEEK) return plural(Math.floor(elapsedSeconds / DAY), 'day')
  return plural(Math.floor(elapsedSeconds / WEEK), 'week')
}

function plural(amount: number, unit: string): string {
  return `${amount} ${unit}${amount === 1 ? '' : 's'} ago`
}

export function formatRuntime(totalMinutes: number): string {
  if (totalMinutes < 60) {
    return `${totalMinutes}m`
  }
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${String(minutes).padStart(2, '0')}m`
}

export function formatYear(iso: string | null | undefined): string | null {
  if (!iso) return null
  const year = new Date(iso).getFullYear()
  return Number.isNaN(year) ? null : String(year)
}

// `10 Dec 2021`, the detail metadata form; locale is fixed so the columns read the same everywhere.
export function formatLongDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

// `S2 E5`, no zero padding and no colon — the copy rule shared with tvOS.
export function formatEpisodeLabel(seasonNumber: number, episodeNumber: number): string {
  return `S${seasonNumber} E${episodeNumber}`
}

export function formatTimeLeft(progress: { positionSeconds: number; durationSeconds: number }): string {
  const remainingMinutes = Math.max(0, Math.round((progress.durationSeconds - progress.positionSeconds) / 60))
  return `${formatRuntime(remainingMinutes)} left`
}
