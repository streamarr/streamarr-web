import { act, waitFor } from '@testing-library/react'
import { HttpResponse, type GraphQLQuery, type GraphQLResponseBody } from 'msw'
import { expect } from 'vitest'
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

type Answer = () => Response | Promise<Response>

/** The server's answer with `data`. */
export function answerWith(data: GraphQLQuery): Answer {
  return () => HttpResponse.json<GraphQLResponseBody<GraphQLQuery>>({ data })
}

/** The server's answer with `data`, held until `release`. */
export function heldAnswer(data: GraphQLQuery) {
  const later = deferred()
  return {
    release: later.resolve,
    answer: async () => {
      await later.promise
      return HttpResponse.json<GraphQLResponseBody<GraphQLQuery>>({ data })
    },
  }
}

/** A request that never reaches the server, as during a flaky reconnect. */
export function networkFailure(): Response {
  return HttpResponse.error()
}

/** A request the server, or a proxy before it, fails with a 5xx. */
export function serverFailure(): Response {
  return new HttpResponse('Internal Server Error', { status: 500 })
}

/** A resolver that gives each request the next of `answers`, then repeats the last. */
export function answersInTurn(...answers: Answer[]) {
  const handler = {
    calls: 0,
    resolver: () => {
      const answer = answers[Math.min(handler.calls, answers.length - 1)]
      handler.calls += 1
      return answer()
    },
  }
  return handler
}

/**
 * Brings the browser back online until `handler` has seen `calls` requests. A read in flight
 * absorbs each return, so the next request proves the earlier read settled.
 */
export async function comeBackOnlineUntil(handler: { calls: number }, calls: number) {
  await waitFor(() => {
    if (handler.calls < calls) window.dispatchEvent(new Event('online'))
    expect(handler.calls).toBe(calls)
  })
}
