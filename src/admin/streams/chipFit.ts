/**
 * How many chips fit beside the first one in the available width, keeping room for a "more" chip
 * whenever any are left out. Widths and the gap between chips are in pixels.
 */
export function fittingChipCount({
  available,
  gap,
  first,
  chips,
  more,
}: Readonly<{
  available: number
  gap: number
  first: number
  chips: readonly number[]
  more: number
}>): number {
  let used = first
  let fit = 0
  for (const [index, width] of chips.entries()) {
    const left = chips.length - index - 1
    const needed = used + gap + width + (left > 0 ? gap + more : 0)
    if (needed > available) break
    used += gap + width
    fit += 1
  }
  return fit
}
