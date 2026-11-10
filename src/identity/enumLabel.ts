/** A server enum value in sentence case, for a quiet label: ACTIVE reads Active. */
export function enumLabel(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ')
}
