/** The name of the parameter a link's fragment carries a code in, as in `#code=BCDFGHJK`. */
export const CODE_PARAMETER = 'code'

/** The code that a link's fragment carries, as in `#code=BCDFGHJK`, or null. */
export function codeInFragment(fragment: string): string | null {
  return new URLSearchParams(fragment.replace(/^#/, '')).get(CODE_PARAMETER)
}
