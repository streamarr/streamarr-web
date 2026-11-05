import { gql, type NormalizedCacheObject } from '@apollo/client'
import { HttpResponse, graphql, http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server } from '../test/server'
import { deferred } from '../test/deferred'
import { createApolloClient } from './client'
import { MarkWatchedDocument, MeDocument, PlaybackReportsDocument } from './generated/graphql'
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
                  selectedProfileState: {
                    __typename: 'SelectedProfileState',
                    watchState: {
                      __typename: 'WatchState',
                      watchStatus: 'WATCHED',
                      watchProgress: null,
                    },
                  },
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
      const nextIdentityMovie = {
        __typename: 'Movie',
        id: 'm1',
        selectedProfileState: {
          __typename: 'SelectedProfileState',
          watchState: { __typename: 'WatchState', watchStatus: 'UNWATCHED', watchProgress: null },
        },
      }
      client.cache.writeFragment({
        fragment: gql`
          fragment NextIdentityMovie on Movie {
            id
            selectedProfileState {
              watchState {
                watchStatus
                watchProgress {
                  positionSeconds
                }
              }
            }
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

  it('shouldKeepTheWatchStateFieldsEachQueryReadWhenAnotherQueryWritesOtherFields', () => {
    const client = createApolloClient(vi.fn())
    const posterFields = gql`
      fragment PosterFields on Movie {
        id
        selectedProfileState {
          watchState {
            watchStatus
            lastWatchedAt
          }
        }
      }
    `
    const detailFields = gql`
      fragment DetailFields on Movie {
        id
        selectedProfileState {
          watchState {
            watchStatus
            watchProgress {
              positionSeconds
            }
          }
        }
      }
    `
    client.cache.writeFragment({
      fragment: posterFields,
      data: {
        __typename: 'Movie',
        id: 'm1',
        selectedProfileState: {
          __typename: 'SelectedProfileState',
          watchState: {
            __typename: 'WatchState',
            watchStatus: 'IN_PROGRESS',
            lastWatchedAt: '2026-10-16T10:00:00Z',
          },
        },
      },
    })

    client.cache.writeFragment({
      fragment: detailFields,
      data: {
        __typename: 'Movie',
        id: 'm1',
        selectedProfileState: {
          __typename: 'SelectedProfileState',
          watchState: {
            __typename: 'WatchState',
            watchStatus: 'IN_PROGRESS',
            watchProgress: { __typename: 'WatchProgress', positionSeconds: 600 },
          },
        },
      },
    })

    expect(client.cache.readFragment({ fragment: posterFields, id: 'Movie:m1' })).toMatchObject({
      selectedProfileState: {
        watchState: { watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T10:00:00Z' },
      },
    })
    expect(client.cache.readFragment({ fragment: detailFields, id: 'Movie:m1' })).toMatchObject({
      selectedProfileState: {
        watchState: { watchProgress: { positionSeconds: 600 } },
      },
    })
  })

  it('shouldKeepACachedLanguagePreferenceWhenAMarkAnswersWithTheWatchStateOnly', async () => {
    server.use(
      graphql.mutation('MarkWatched', () =>
        HttpResponse.json({
          data: {
            markWatched: {
              item: {
                __typename: 'Movie',
                id: 'm1',
                selectedProfileState: {
                  __typename: 'SelectedProfileState',
                  watchState: {
                    __typename: 'WatchState',
                    watchStatus: 'WATCHED',
                    watchProgress: null,
                  },
                },
              },
              userErrors: [],
            },
          },
        }),
      ),
    )
    const client = createApolloClient(vi.fn())
    const languageFields = gql`
      fragment LanguageFields on Movie {
        id
        selectedProfileState {
          languagePreference {
            audioLanguages
            subtitleMode
          }
        }
      }
    `
    client.cache.writeFragment({
      fragment: languageFields,
      data: {
        __typename: 'Movie',
        id: 'm1',
        selectedProfileState: {
          __typename: 'SelectedProfileState',
          languagePreference: {
            __typename: 'LanguagePreference',
            audioLanguages: ['JA'],
            subtitleMode: 'FORCED',
          },
        },
      },
    })

    await client.mutate({ mutation: MarkWatchedDocument, variables: { input: { itemId: 'm1' } } })

    expect(client.cache.readFragment({ fragment: languageFields, id: 'Movie:m1' })).toMatchObject({
      selectedProfileState: {
        languagePreference: { audioLanguages: ['JA'], subtitleMode: 'FORCED' },
      },
    })
  })
})

describe('shared playback report pages', () => {
  // A page of reports `from` to `to` as the server answers it, each cursor its report's position.
  function reportsPage(from: number, to: number, hasNextPage: boolean) {
    const positions = Array.from({ length: to - from + 1 }, (_, index) => from + index)
    return {
      playbackReports: {
        __typename: 'PlaybackReportConnection' as const,
        edges: positions.map((position) => ({
          __typename: 'PlaybackReportEdge' as const,
          cursor: String(position),
          node: {
            __typename: 'PlaybackReport' as const,
            id: `report-${position}`,
            sharedAt: '2026-11-04T18:30:00Z',
            readAt: null,
            profileName: `Viewer ${position}`,
            note: null,
          },
        })),
        pageInfo: { __typename: 'PageInfo' as const, hasNextPage, endCursor: String(to) },
      },
    }
  }

  function listedIds(client: ReturnType<typeof createApolloClient>): string[] {
    const list = client.cache.readQuery({
      query: PlaybackReportsDocument,
      variables: { first: 2 },
    })
    return list?.playbackReports.edges.map((edge) => edge.node.id) ?? []
  }

  it('shouldDropAnOlderPageWhenItAnswersAfterARefreshReplacedTheReportItFollows', () => {
    const client = createApolloClient(vi.fn())
    const write = (after: string | undefined, data: ReturnType<typeof reportsPage>) =>
      client.cache.writeQuery({
        query: PlaybackReportsDocument,
        variables: { first: 2, after },
        data,
      })
    write(undefined, reportsPage(1, 2, true))
    write('2', reportsPage(3, 4, true))

    // A refresh of the newest reports answers first; the page after report 4 answers last.
    write(undefined, reportsPage(1, 2, true))
    write('4', reportsPage(5, 6, true))

    expect(listedIds(client)).toEqual(['report-1', 'report-2'])
  })

  it('shouldAppendAnOlderPageWhenItFollowsTheLastLoadedReport', () => {
    const client = createApolloClient(vi.fn())
    const write = (after: string | undefined, data: ReturnType<typeof reportsPage>) =>
      client.cache.writeQuery({
        query: PlaybackReportsDocument,
        variables: { first: 2, after },
        data,
      })
    write(undefined, reportsPage(1, 2, true))

    write('2', reportsPage(3, 4, false))

    expect(listedIds(client)).toEqual(['report-1', 'report-2', 'report-3', 'report-4'])
  })
})
