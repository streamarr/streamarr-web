/** How a count reads after a menu entry's label: nothing at zero, and "99+" beyond 99. */
export function countText(count: number): string | null {
  if (count <= 0) return null
  return count > 99 ? '99+' : String(count)
}
