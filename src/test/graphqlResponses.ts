import { act } from '@testing-library/react'
import { HttpResponse, type GraphQLQuery, type GraphQLResponseBody } from 'msw'
import { deferred } from './deferred'

/** The server's answer to an id it cannot parse, reported on the query's `rootField`. */
export function invalidIdResponse(rootField: string) {
  return HttpResponse.json<GraphQLResponseBody<GraphQLQuery>>({
    errors: [
      {
        message: 'Invalid ID format: abc',
        path: [rootField],
        extensions: { errorType: 'BAD_REQUEST', code: 'INVALID_INPUT' },
      },
    ],
    data: null,
  })
}

/** A resolver that fails the first request without a code and answers `data` after that. */
export function failsOnceThen(data: GraphQLQuery) {
  const handler = {
    calls: 0,
    resolver: () => {
      handler.calls += 1
      return HttpResponse.json<GraphQLResponseBody<GraphQLQuery>>(
        handler.calls === 1 ? { errors: [{ message: 'boom' }] } : { data },
      )
    },
  }
  return handler
}

/**
 * A resolver that answers `first` at once, then holds every later request until `release` and
 * answers it with `next`, so a test can look at the screen while a read is in flight.
 */
export function answersThenHolds(first: GraphQLQuery, next: GraphQLQuery) {
  const later = deferred()
  const handler = {
    calls: 0,
    release: later.resolve,
    resolver: async () => {
      handler.calls += 1
      if (handler.calls === 1) {
        return HttpResponse.json<GraphQLResponseBody<GraphQLQuery>>({ data: first })
      }
      await later.promise
      return HttpResponse.json<GraphQLResponseBody<GraphQLQuery>>({ data: next })
    },
  }
  return handler
}

/** Brings the browser back online, which reads every active query again. */
export function comeBackOnline() {
  act(() => {
    window.dispatchEvent(new Event('online'))
  })
}
