import type { components, paths } from './generated/openapi'

// Type-level views over the generated OpenAPI document; the HTTP client itself is ./http.ts.

export type Schema<N extends keyof components['schemas']> = components['schemas'][N]

type Operation<P extends keyof paths, M extends keyof paths[P]> = NonNullable<paths[P][M]>

// Every body has exactly one media type: `application/json` in, `*/*` (JSON on the wire) out.
type Content<T> = T extends { content: { '*/*': infer B } }
  ? B
  : T extends { content: { 'application/json': infer B } }
    ? B
    : never

type Success<R> = R extends { 200: infer S } ? S : R extends { 201: infer S } ? S : never

export type RequestBody<P extends keyof paths, M extends keyof paths[P]> =
  Operation<P, M> extends { requestBody?: infer B } ? Content<NonNullable<B>> : never

export type Response2xx<P extends keyof paths, M extends keyof paths[P]> =
  Operation<P, M> extends { responses: infer R } ? Content<Success<R>> : never
