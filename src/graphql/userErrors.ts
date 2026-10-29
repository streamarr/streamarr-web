// Unknown union members are expected input (the server deploys new members before clients can
// parse them), so everything here works from the shared MutationError fields alone.

export interface UserErrorLike {
  readonly __typename?: string
  readonly message?: string | null
  readonly inputPath?: readonly string[] | null
}

const GENERIC_MESSAGE = 'Something went wrong. Please try again.'

/** The member's own message, or the generic fallback for an unknown or messageless member. */
export function userErrorMessage(error: UserErrorLike | null | undefined): string {
  return userErrorMessageOr(error, GENERIC_MESSAGE)
}

/** The member's own message, or the caller's fallback for an unknown or messageless member. */
export function userErrorMessageOr(
  error: UserErrorLike | null | undefined,
  fallback: string,
): string {
  const message = error?.message?.trim()
  return message || fallback
}

export const FORM_ERRORS = ''

/** Errors keyed by their dotted input path; path-less members group under FORM_ERRORS. */
export function groupByInputPath<E extends UserErrorLike>(
  errors: readonly E[] | null | undefined,
): Map<string, E[]> {
  const grouped = new Map<string, E[]>()
  for (const error of errors ?? []) {
    const key = error.inputPath?.length ? error.inputPath.join('.') : FORM_ERRORS
    const bucket = grouped.get(key)
    if (bucket) {
      bucket.push(error)
    } else {
      grouped.set(key, [error])
    }
  }
  return grouped
}
