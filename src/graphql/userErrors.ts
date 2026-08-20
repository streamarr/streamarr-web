// ADR 0026 user-error helpers: every mutation error implements MutationError (message), and
// input-bound members add inputPath. Unknown union members are expected input — the server
// deploys new members only after clients can parse them — so everything here works from the
// shared fields alone and never switches exhaustively on __typename.

export interface UserErrorLike {
  readonly __typename?: string
  readonly message?: string | null
  readonly inputPath?: readonly string[] | null
}

const GENERIC_MESSAGE = 'Something went wrong. Please try again.'

/** The member's own message, or the generic fallback for an unknown or messageless member. */
export function userErrorMessage(error: UserErrorLike | null | undefined): string {
  const message = error?.message?.trim()
  return message ? message : GENERIC_MESSAGE
}

/** Errors keyed by their dotted input path; path-less members group under the form itself. */
export const FORM_ERRORS = ''

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
