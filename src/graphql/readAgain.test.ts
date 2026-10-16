import { ApolloClient, ApolloLink, gql, InMemoryCache } from '@apollo/client'
import { Observable } from 'rxjs'
import { describe, expect, it } from 'vitest'
import { deferred } from '../test/deferred'
import { readActiveQueriesAgain, readAgainAfterTheReadInFlight } from './readAgain'

type Title = { title: { __typename: 'Movie'; id: string; watchStatus: string } }

const TITLE = gql`
  query Title {
    title {
      id
      watchStatus
    }
  }
`

function titleWith(watchStatus: string): Title {
  return { title: { __typename: 'Movie', id: 'm1', watchStatus } }
}

// A link that holds every request until the test answers it.
function fakeServer() {
  const requests: { answer: (data: Title) => void; fail: (error: Error) => void }[] = []
  let arrival = deferred()
  const link = new ApolloLink(
    () =>
      new Observable((subscriber) => {
        requests.push({
          answer: (data) => {
            subscriber.next({ data })
            subscriber.complete()
          },
          fail: (error) => subscriber.error(error),
        })
        arrival.resolve()
        arrival = deferred()
      }),
  )
  return {
    requests,
    client: new ApolloClient({ link, cache: new InMemoryCache() }),
    async requestNumber(count: number) {
      while (requests.length < count) await arrival.promise
      return requests[count - 1]
    },
  }
}

async function watchTitle(server: ReturnType<typeof fakeServer>) {
  const query = server.client.watchQuery({ query: TITLE })
  query.subscribe(() => {})
  ;(await server.requestNumber(1)).answer(titleWith('UNWATCHED'))
  return { query }
}

function cachedWatchStatus(client: ApolloClient) {
  return client.readQuery<Title>({ query: TITLE })?.title.watchStatus
}

describe('readAgainAfterTheReadInFlight', () => {
  it('shouldReadNothingWhenNoReadIsInFlight', async () => {
    const server = fakeServer()
    const { query } = await watchTitle(server)

    expect(readAgainAfterTheReadInFlight(server.client, query)).toBeUndefined()
    expect(server.requests).toHaveLength(1)
  })

  it('shouldReadAgainAfterTheReadInFlightAnswersWhenThatReadWasSentEarlier', async () => {
    const server = fakeServer()
    const { query } = await watchTitle(server)
    void readActiveQueriesAgain(server.client)
    const earlier = await server.requestNumber(2)
    server.client.cache.writeQuery({ query: TITLE, data: titleWith('WATCHED') })

    const reading = readAgainAfterTheReadInFlight(server.client, query)
    earlier.answer(titleWith('UNWATCHED'))
    ;(await server.requestNumber(3)).answer(titleWith('WATCHED'))
    await reading

    expect(server.requests).toHaveLength(3)
    expect(cachedWatchStatus(server.client)).toBe('WATCHED')
  })

  it('shouldNotReadAgainWhenTheReadInFlightFails', async () => {
    const server = fakeServer()
    const { query } = await watchTitle(server)
    void readActiveQueriesAgain(server.client)
    const earlier = await server.requestNumber(2)
    server.client.cache.writeQuery({ query: TITLE, data: titleWith('WATCHED') })

    const reading = readAgainAfterTheReadInFlight(server.client, query)
    earlier.fail(new TypeError('Failed to fetch'))
    await reading

    expect(server.requests).toHaveLength(2)
    expect(cachedWatchStatus(server.client)).toBe('WATCHED')
  })

  it('shouldNotReadAgainWhenTheStoreIsClearedDuringTheReadInFlight', async () => {
    const server = fakeServer()
    const { query } = await watchTitle(server)
    void readActiveQueriesAgain(server.client).catch(() => {})
    await server.requestNumber(2)

    const reading = readAgainAfterTheReadInFlight(server.client, query)
    await server.client.clearStore()
    await reading

    expect(server.requests).toHaveLength(2)
    expect(cachedWatchStatus(server.client)).toBeUndefined()
  })
})
