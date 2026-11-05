import type { FieldMergeFunction, FieldPolicy, Reference } from '@apollo/client/cache'
import { relayStylePagination, type RelayFieldPolicy } from '@apollo/client/utilities'

type RelayMerge =
  RelayFieldPolicy<Reference> extends FieldPolicy<infer Existing, infer Incoming>
    ? FieldMergeFunction<Existing, Incoming>
    : never

/**
 * Relay-style pages that append only after an edge the list still holds. A read of the first page
 * replaces the loaded edges, so a page that answers later for a cursor the list no longer holds
 * belongs to the replaced list and is dropped: appended, it would leave a gap.
 */
export function contiguousRelayPagination(): RelayFieldPolicy<Reference> {
  const relay = relayStylePagination()
  const merge = relay.merge as RelayMerge
  return {
    ...relay,
    merge(existing, incoming, options) {
      const after: unknown = options.args?.after
      if (
        typeof after === 'string' &&
        existing &&
        !existing.edges.some((edge) => edge.cursor === after)
      ) {
        return existing
      }
      return merge(existing, incoming, options)
    },
  }
}
