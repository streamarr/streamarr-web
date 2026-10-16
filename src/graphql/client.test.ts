import { gql, type NormalizedCacheObject } from '@apollo/client'
import { HttpResponse, graphql, http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../test/server'
import { deferred } from '../test/deferred'
import { createApolloClient } from './client'
import { MarkWatchedDocument, MeDocument } from './generated/graphql'
import { meFixture } from '../test/meFixture'

const ME = meFixture({ scope: 'profile' })

describe('apollo client', () => {
  afterEach(() => {
    document.cookie = '__Host-XSRF-TOKEN=; Max-Age=0; Secure; Path=/'
    document.cookie = 'XSRF-TOKEN=; Max-Age=0; Path=/'
  })

  it('shouldOmitCsrfHeaderWhenNoTokenCookieIssuedYet', async () => {
    document.cookie = 'XSRF-TOKEN=; max-age=0'
    let header: string | null = 'unset'
    server.use(
      graphql.query('Me', ({ request }) => {
        header = request.headers.get('X-XSRF-TOKEN')
        return HttpResponse.json({ data: { me: ME } })
      }),
    )

    await createApolloClient(vi.fn()).query({ query: MeDocument })

    expect(header).toBeNull()
  })

  it('shouldNotRouteAuthErrorsForOperationsThatOptOut', async () => {
    server.use(
      http.post('/graphql', () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
    )
    const onAuthRoute = vi.fn()
    const client = createApolloClient(onAuthRoute)

    await client.query({ query: MeDocument, context: { skipAuthRouting: true } }).catch(() => {})

    expect(onAuthRoute).not.toHaveBeenCalled()
  })

  it('shouldAttachCsrfHeaderMatchingTheCookieOnEveryOperation', async () => {
    document.cookie = '__Host-XSRF-TOKEN=csrf-graphql; Secure; Path=/'
    const headers: (string | null)[] = []
    server.use(
      graphql.query('Me', ({ request }) => {
        headers.push(request.headers.get('X-XSRF-TOKEN'))
        return HttpResponse.json({ data: { me: ME } })
      }),
    )
    const client = createApolloClient(vi.fn())

    await client.query({ query: MeDocument })
    document.cookie = '__Host-XSRF-TOKEN=csrf-replaced; Secure; Path=/'
    await client.query({ query: MeDocument, fetchPolicy: 'network-only' })

    expect(headers).toEqual(['csrf-graphql', 'csrf-replaced'])
  })

  it('shouldRetryOnceWithTheRemintedTokenWhenCsrfIsRejected', async () => {
    document.cookie = '__Host-XSRF-TOKEN=stale-token; Secure; Path=/'
    const headers: (string | null)[] = []
    server.use(
      http.post('/graphql', ({ request }) => {
        headers.push(request.headers.get('X-XSRF-TOKEN'))
        if (headers.length === 1) {
          document.cookie = '__Host-XSRF-TOKEN=fresh-token; Secure; Path=/'
          return HttpResponse.json(
            {
              code: 'CSRF_TOKEN_REQUIRED',
              message: 'The CSRF token is missing or invalid.',
            },
            { status: 403 },
          )
        }
        return HttpResponse.json({ data: { me: ME } })
      }),
    )

    await expect(createApolloClient(vi.fn()).query({ query: MeDocument })).resolves.toMatchObject({
      data: { me: ME },
    })
    expect(headers).toEqual(['stale-token', 'fresh-token'])
  })

  it('shouldStopAfterOneRetryWhenCsrfIsRejectedAgain', async () => {
    let attempts = 0
    server.use(
      http.post('/graphql', () => {
        attempts += 1
        return HttpResponse.json({ code: 'CSRF_TOKEN_REQUIRED' }, { status: 403 })
      }),
    )

    await expect(createApolloClient(vi.fn()).query({ query: MeDocument })).rejects.toBeDefined()
    expect(attempts).toBe(2)
  })

  it('shouldNotRetryUnrelatedForbiddenResponses', async () => {
    let attempts = 0
    server.use(
      http.post('/graphql', () => {
        attempts += 1
        return HttpResponse.json({ code: 'FORBIDDEN' }, { status: 403 })
      }),
    )

    await expect(createApolloClient(vi.fn()).query({ query: MeDocument })).rejects.toBeDefined()
    expect(attempts).toBe(1)
  })

  it.each(['resetStore', 'clearStore'] as const)(
    'shouldKeepAResponseSentBeforeAStoreResetOutOfTheCacheWhenCalling %s',
    async (reset) => {
      const requested = deferred()
      const answer = deferred()
      server.use(
        graphql.mutation('MarkWatched', async () => {
          requested.resolve()
          await answer.promise
          return HttpResponse.json({
            data: {
              markWatched: {
                item: {
                  __typename: 'Movie',
                  id: 'm1',
                  watchStatus: 'WATCHED',
                  watchProgress: null,
                },
                userErrors: [],
              },
            },
          })
        }),
      )
      const client = createApolloClient(vi.fn())
      const mark = client.mutate({
        mutation: MarkWatchedDocument,
        variables: { input: { itemId: 'm1' } },
      })
      await requested.promise

      await client[reset]()
      const nextIdentityMovie = { __typename: 'Movie', id: 'm1', watchStatus: 'UNWATCHED' }
      client.cache.writeFragment({
        fragment: gql`
          fragment NextIdentityMovie on Movie {
            id
            watchStatus
          }
        `,
        data: nextIdentityMovie,
      })
      answer.resolve()

      const outcome = await mark.then(
        () => 'saved',
        () => 'discarded',
      )

      expect((client.cache.extract() as NormalizedCacheObject)['Movie:m1']).toMatchObject(
        nextIdentityMovie,
      )
      expect(outcome).toBe('discarded')
    },
  )
})
