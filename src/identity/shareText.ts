export const UPDATE_FAILED_MESSAGE = "Couldn't update sharing."

const UNITS = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
] as const

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'always' })

/**
 * How long a code or an offer has left, to the nearest whole unit: "Expires in 7 days" for a code
 * issued a moment ago. A time that rounds up to the next unit says that unit: "Expires in 1 day".
 */
export function expiryLabel(expiresAt: string, now: Date): string {
  const left = new Date(expiresAt).getTime() - now.getTime()
  if (!(left > 0)) {
    return 'Expired'
  }
  const [, size] = largestUnitIn(left)
  const rounded = Math.max(1, Math.round(left / size)) * size
  const [unit, unitSize] = largestUnitIn(rounded)
  return `Expires ${relative.format(Math.round(rounded / unitSize), unit)}`
}

function largestUnitIn(time: number): (typeof UNITS)[number] {
  return UNITS.find(([, size]) => time >= size) ?? UNITS[UNITS.length - 1]
}
