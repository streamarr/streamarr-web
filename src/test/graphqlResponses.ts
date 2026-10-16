import { HttpResponse, type GraphQLQuery, type GraphQLResponseBody } from 'msw'

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
