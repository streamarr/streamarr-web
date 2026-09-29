import { CombinedGraphQLErrors } from '@apollo/client/errors'
import type { GraphQLFormattedError } from 'graphql'

// ADR 0026: a coded data-fetcher error carries a sanitized sentence meant for people. INTERNAL is
// the server's placeholder for a failure it will not describe, and uncoded errors come from
// graphql-java itself; neither is shown.
const UNDESCRIBED_CODE = 'INTERNAL'

/** The server's sentence for a failed request when it sent one, otherwise the screen's own. */
export function requestFailureMessage(error: unknown, fallback: string): string {
  if (!CombinedGraphQLErrors.is(error)) {
    return fallback
  }
  return error.errors.map(serverSentence).find((sentence) => sentence !== null) ?? fallback
}

function serverSentence(error: GraphQLFormattedError): string | null {
  const code = error.extensions?.code
  if (typeof code !== 'string' || code === UNDESCRIBED_CODE) {
    return null
  }
  return error.message.trim() || null
}
