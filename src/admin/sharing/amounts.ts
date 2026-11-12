/** A unit a setting is counted in, and how many of the setting's server unit one of it holds. */
export interface Unit {
  size: number
  one: string
  many: string
}

/** The units a setting may be counted in, from the smallest. */
export type Units = readonly [Unit, ...Unit[]]

/** A setting as the server last confirmed it: a whole number and the range the server accepts. */
export interface StoredAmount {
  value: number
  minimum: number
  maximum: number
}

/** An amount as a count of one unit. */
export interface Count {
  count: number
  unit: Unit
}

/** The amount in the largest of the units that holds it whole: 168 hours is 7 days. */
export function wholeCount(amount: number, units: Units): Count {
  const unit = units.findLast((candidate) => amount % candidate.size === 0) ?? units[0]
  return { count: amount / unit.size, unit }
}

/** Names a count of a unit: "1 code", "20 codes". */
function countOf(count: number, unit: Unit): string {
  return `${count} ${count === 1 ? unit.one : unit.many}`
}

/** Names an amount in the largest of the units that holds it whole: "7 days". */
export function amountOf(amount: number, units: Units): string {
  const { count, unit } = wholeCount(amount, units)
  return countOf(count, unit)
}

/** The refusal of an amount outside the server's range, in the words the server refuses it in. */
export function rangeRefusal(amount: number, stored: StoredAmount, units: Units): string | null {
  if (amount >= stored.minimum && amount <= stored.maximum) return null
  const lowest = wholeCount(stored.minimum, units)
  const highest = wholeCount(stored.maximum, units)
  // Where both ends share a unit, it is named once: "Choose from 1 to 100 codes."
  const from =
    lowest.unit === highest.unit ? String(lowest.count) : countOf(lowest.count, lowest.unit)
  return `Choose from ${from} to ${countOf(highest.count, highest.unit)}.`
}
