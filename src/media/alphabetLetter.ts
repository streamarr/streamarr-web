// Returns a plain string rather than the generated `AlphabetLetter` enum type: this only ever
// produces 'A'-'Z' or 'HASH' from title text, never the schema's future-proofing sentinel member,
// so it stays comparable against real `AlphabetLetter` values without importing generated types
// into this pure, codegen-independent module.
//
// Ports streamarr-apple's AlphabetLetter.fromTitle: diacritic-fold then uppercase the first
// character, falling back to HASH for anything non-alphabetic.
export function alphabetLetterFromTitle(titleSort: string): string {
  const folded = titleSort.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim()
  const first = folded.charAt(0).toUpperCase()
  return first.length === 1 && first >= 'A' && first <= 'Z' ? first : 'HASH'
}
