/** A unit a setting is counted in, and how many of the setting's server unit one of it holds. */
export interface Unit {
  size: number
  one: string
  many: string
}

/** A setting as the server last confirmed it: a whole number and the range the server accepts. */
export interface StoredAmount {
  value: number
  minimum: number
  maximum: number
}

/** Names a count of a unit: "1 code", "20 codes". */
export function countOf(count: number, unit: Unit): string {
  return `${count} ${count === 1 ? unit.one : unit.many}`
}

/** The refusal of an amount outside the server's range, in the words the server refuses it in. */
export function rangeRefusal(amount: number, stored: StoredAmount, unit: Unit): string | null {
  if (amount >= stored.minimum && amount <= stored.maximum) return null
  return `Choose from ${stored.minimum} to ${countOf(stored.maximum, unit)}.`
}
