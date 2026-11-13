import {
  ApolloClient,
  ApolloLink,
  gql,
  InMemoryCache,
  type TypedDocumentNode,
} from '@apollo/client'
import { ApolloProvider, useQuery } from '@apollo/client/react'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Observable } from 'rxjs'
import { describe, expect, it } from 'vitest'
import { deferred } from '../test/deferred'
import { useLiveList, liveListLink } from './liveList'
import { readActiveQueriesAgain } from './readAgain'

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

function nameOf(id: string): Name {
  return { __typename: 'Name', id }
}

/**
 * The server's half: each read answers with the names as they stand when it arrives. `holdNext`
 * keeps the next read's answer until released.
 */
function namesServer(names: string[]) {
  const state = { names, holding: null as { arrived: () => void; release: Promise<void> } | null }
  const link = new ApolloLink(
    () =>
      new Observable((observer) => {
        const answer = { data: { names: state.names.map(nameOf) } }
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
    client: new ApolloClient({
      cache: new InMemoryCache(),
      link: ApolloLink.from([liveListLink, link]),
    }),
    holdNext() {
      const arrived = deferred()
      const release = deferred()
      state.holding = { arrived: arrived.resolve, release: release.promise }
      return { arrived: arrived.promise, release: release.resolve }
    },
  }
}

// A component that lists the names and puts each arriving name first.
function useNames() {
  const list = useLiveList({
    query: NAMES,
    variables: {},
    keyOf: (change: Name) => change.id,
    apply: (data, change) => ({
      names: [change, ...data.names.filter(({ id }) => id !== change.id)],
    }),
  })
  const { data } = useQuery(NAMES, { fetchPolicy: 'network-only', context: list.context })
  return { receive: list.receive, names: data?.names.map(({ id }) => id) }
}

describe('useLiveList', () => {
  it('shouldKeepAChangeTheListReceivedAfterARemountWhenAReadSentBeforeTheRemountAnswers', async () => {
    const server = namesServer(['alex'])
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApolloProvider client={server.client}>{children}</ApolloProvider>
    )
    const before = renderHook(useNames, { wrapper })
    await waitFor(() => expect(before.result.current.names).toEqual(['alex']))
    server.state.names = ['mara', 'alex']
    const read = server.holdNext()
    void readActiveQueriesAgain(server.client)
    await read.arrived

    before.unmount()
    const after = renderHook(useNames, { wrapper })
    server.state.names = ['leo', 'mara', 'alex']
    act(() => after.result.current.receive(nameOf('leo')))
    read.release()

    await waitFor(() => expect(after.result.current.names).toContain('mara'))
    expect(after.result.current.names).toEqual(['leo', 'mara', 'alex'])
  })
})
