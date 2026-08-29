import type { AmbientColors } from './ambientTheme'

interface AmbientCandidate {
  ambientColors: AmbientColors | null
}

type CandidateList = ReadonlyArray<AmbientCandidate | null> | null | undefined

// Principle 1 tints from the backdrop, but a season usually has none of its own and artwork the
// server has not colored yet carries nothing. Callers pass their candidates in preference order —
// own backdrops, the parent's backdrops, own posters — and the first colored one wins.
export function resolveAmbientColors(...candidates: CandidateList[]): AmbientColors | null {
  for (const list of candidates) {
    const colors = list?.find((image) => image?.ambientColors)?.ambientColors
    if (colors) {
      return colors
    }
  }
  return null
}
