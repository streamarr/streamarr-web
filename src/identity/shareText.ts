export const UPDATE_FAILED_MESSAGE = "Couldn't update sharing."

/** The start of an id, where the server gives no name for what it identifies. */
export function shortId(id: string): string {
  return id.slice(0, 8)
}

const UNITS = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
] as const

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'always' })

/** How long an offer has left, in its largest whole unit: "Expires in 6 days". */
export function expiryLabel(expiresAt: string, now: Date): string {
  const left = new Date(expiresAt).getTime() - now.getTime()
  if (!(left > 0)) {
    return 'Expired'
  }
  const [unit, size] = UNITS.find(([, size]) => left >= size) ?? ['minute', left]
  return `Expires ${relative.format(Math.floor(left / size), unit)}`
}

const HOUSEHOLD_ID =
  /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/i

/** The Household id that `text` holds, or null. An id is often pasted with the text around it. */
export function householdIdIn(text: string): string | null {
  return HOUSEHOLD_ID.exec(text)?.[0] ?? null
}
