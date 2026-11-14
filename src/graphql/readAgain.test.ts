import {
  ApolloClient,
  ApolloLink,
  gql,
  InMemoryCache,
  type TypedDocumentNode,
} from '@apollo/client'
import { graphql, HttpResponse } from 'msw'
import { Observable } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '../test/deferred'
import { server } from '../test/server'
import { createApolloClient } from './client'
import { isReading, refetchAfterReadsInFlight } from './readAgain'

const LIBRARIES = gql`
  query Libraries {
    libraries {
      id
      name
    }
  }
`

describe('isReading', () => {
  it('shouldSayAQueryReadsWhileItsOwnReadIsOutAndNotOnceItAnswers', async () => {
    const answer = deferred()
    server.use(
      graphql.query('Libraries', async () => {
        await answer.promise
        return HttpResponse.json({ data: { libraries: [] } })
      }),
    )
    const query = createApolloClient(vi.fn()).watchQuery({ query: LIBRARIES })
    query.subscribe({})

    expect(isReading(query)).toBe(true)
    answer.resolve()

    await vi.waitFor(() => expect(isReading(query)).toBe(false))
  })
})

interface Name {
  __typename: 'Name'
  id: string
}

const NAMES: TypedDocumentNode<{ names: Name[] }, Record<string, never>> = gql`
  query Names {
    names {
      id
    }
  }
`

/**
 * The server's half: each read answers with the names as they stand when it arrives. `holdNext`
 * keeps the next read's answer until released.
 */
function namesServer(names: string[]) {
  const state = {
    names,
    reads: 0,
    holding: null as { arrived: () => void; release: Promise<void> } | null,
  }
  const link = new ApolloLink(
    () =>
      new Observable((observer) => {
        state.reads += 1
        const answer = { data: { names: state.names.map((id) => ({ __typename: 'Name', id })) } }
        const held = state.holding
        state.holding = null
        void (async () => {
          if (held) {
            held.arrived()
            await held.release
          }
          observer.next(answer)
          observer.complete()
        })()
      }),
  )
  return {
    state,
    client: new ApolloClient({ cache: new InMemoryCache(), link }),
    holdNext() {
      const arrived = deferred()
      const release = deferred()
      state.holding = { arrived: arrived.resolve, release: release.promise }
      return { arrived: arrived.promise, release: release.resolve }
    },
  }
}

// The names that the cache keeps, as every screen watching the query shows them.
function namesKept(client: ApolloClient) {
  return client.readQuery({ query: NAMES })?.names.map(({ id }) => id)
}

describe('refetchAfterReadsInFlight', () => {
  it('shouldKeepTheNamesAsTheyStandAfterTheCallWhenAReadSentBeforeTheCallIsInFlight', async () => {
    const server = namesServer(['alex'])
    const query = server.client.watchQuery({ query: NAMES, fetchPolicy: 'network-only' })
    const watching = query.subscribe(() => undefined)
    try {
      await query.refetch()
      const read = server.holdNext()
      void query.refetch()
      await read.arrived
      server.state.names = ['mara', 'alex']

      const refetched = refetchAfterReadsInFlight(query)
      read.release()
      await refetched

      expect(namesKept(server.client)).toEqual(['mara', 'alex'])
    } finally {
      watching.unsubscribe()
    }
  })

  it('shouldReadOnceWhenNoReadIsInFlight', async () => {
    const server = namesServer(['alex'])
    const query = server.client.watchQuery({ query: NAMES, fetchPolicy: 'network-only' })
    const watching = query.subscribe(() => undefined)
    try {
      await query.refetch()
      const readsBefore = server.state.reads
      server.state.names = ['mara', 'alex']

      await refetchAfterReadsInFlight(query)

      expect(server.state.reads - readsBefore).toBe(1)
      expect(namesKept(server.client)).toEqual(['mara', 'alex'])
    } finally {
      watching.unsubscribe()
    }
  })
})
