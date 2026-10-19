import { CombinedGraphQLErrors } from '@apollo/client/errors'

/** A failed descendant or ancestor makes this response subtree unsafe to cache. */
export function responsePathHasError(error: unknown, responsePath: readonly (string | number)[]) {
  if (error === undefined) return false
  if (!CombinedGraphQLErrors.is(error)) return true
  return error.errors.some(
    ({ path }) =>
      path == null ||
      path.slice(0, responsePath.length).every((part, index) => responsePath[index] === part),
  )
}
