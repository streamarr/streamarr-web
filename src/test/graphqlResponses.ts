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
