import { InMemoryCache } from '@apollo/client'
import { act, screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse, type GraphQLQuery } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  HomeDocument,
  WatchStateChangedDocument,
  type LibraryPageQueryVariables,
} from '../graphql/generated/graphql'
import possibleTypes from '../graphql/generated/possibleTypes.json'
import cases from '../test/contracts/live-lists.json'
import { watchingMovie, watchingConnection, watchingChange } from '../test/continueWatchingFixtures'
import {
  applyWatchStateToLists,
  CONTINUE_WATCHING_LIMIT,
  showContinueWatching,
} from './watchStateLists'
import { LibraryContentsProvider } from '../library/LibraryContentsProvider'
import { useLibraryItems } from '../library/useLibraryItems'
import { addition, movie, LIBRARY } from '../test/libraryContentsFixtures'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'

function LibraryWindow({ startLetter }: { startLetter: 'A' | null }) {
  const view = useLibraryItems({
    libraryId: LIBRARY,
    sort: { by: 'TITLE', direction: 'ASC' },
    filter: startLetter ? { startLetter } : {},
    columns: 1,
  })
  return (
    <>
      <ol aria-label="Window">
        {view.edges.map(({ node }) => (
          <li key={node.id}>{node.id}</li>
        ))}
      </ol>
      <output aria-label="Watch states">
        {view.edges.map(({ node }) => node.watchStatus).join(',')}
      </output>
      <button onClick={view.loadMore}>More</button>
      <button onClick={view.retry}>Retry</button>
    </>
  )
}

function ids() {
  return within(screen.getByRole('list', { name: 'Window' }))
    .queryAllByRole('listitem')
    .map((row) => row.textContent)
}

describe('shared live-list conformance', () => {
  it('shouldApplyTheCanonicalShelfSequenceAtTheWebCap', () => {
    const cache = new InMemoryCache({ possibleTypes: possibleTypes.possibleTypes })
    const release = showContinueWatching(cache)
    const query = {
      query: HomeDocument,
      variables: { continueWatchingFirst: CONTINUE_WATCHING_LIMIT },
    }
    cache.writeQuery({
      ...query,
      data: {
        continueWatching: {
          ...watchingConnection([]),
          edges: cases.continueWatching.initial
            .slice(0, CONTINUE_WATCHING_LIMIT)
            .map((item) => watchingChange(watchingMovie(item), item.orderKey).edge),
        },
        libraries: [],
      },
    })
    try {
      for (const step of cases.continueWatching.steps) {
        const item = watchingMovie({
          id: step.change.itemId,
          orderKey: step.change.edge?.orderKey ?? null,
        })
        cache.writeQuery({
          query: WatchStateChangedDocument,
          data: {
            watchStateChanged: {
              items: [item],
              continueWatching: [watchingChange(item, step.change.edge?.orderKey ?? null)],
            },
          },
        })
        applyWatchStateToLists(cache, [watchingChange(item, step.change.edge?.orderKey ?? null)])
        expect(
          cache.readQuery(query)?.continueWatching.edges.map((entry) => entry?.node?.id),
          step.name,
        ).toEqual(step.expected['12'])
      }
    } finally {
      release()
    }
  })

  it.each(cases.library)('shouldApplyTheCanonicalLibraryScenario: $name', async (scenario) => {
    let saved = scenario.initial
    let recovered = false
    server.use(
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        let start = 0
        if (variables.after)
          start = saved.findIndex((item) => `cursor-${item.id}` === variables.after) + 1
        if (variables.before)
          start = Math.max(
            0,
            saved.findIndex((item) => `cursor-${item.id}` === variables.before) - scenario.pageSize,
          )
        if (!variables.after && !variables.before && variables.filter?.startLetter)
          start = Math.max(
            0,
            saved.findIndex((item) => item.title.startsWith(variables.filter!.startLetter!)),
          )
        const end = variables.before
          ? saved.findIndex((item) => `cursor-${item.id}` === variables.before)
          : start + scenario.pageSize
        const page = saved.slice(start, end)
        return HttpResponse.json({
          data: {
            library: {
              __typename: 'Library',
              id: LIBRARY,
              name: 'Movies',
              itemCount: saved.length,
              alphabetIndex: [],
              items: {
                edges: page.map((item) => ({
                  __typename: 'MediaEdge' as const,
                  cursor: `cursor-${item.id}`,
                  orderKey: item.orderKey,
                  node: { ...movie(item), watchStatus: recovered ? 'WATCHED' : 'UNWATCHED' },
                })),
                pageInfo: {
                  hasPreviousPage: start > 0,
                  hasNextPage: end < saved.length,
                  startCursor: page[0] ? `cursor-${page[0].id}` : null,
                  endCursor: page.at(-1) ? `cursor-${page.at(-1)!.id}` : null,
                },
              },
            },
          },
        })
      }),
    )
    const socket = serveGraphqlSocket()
    const { user } = renderWithProviders(
      <LibraryContentsProvider profileId="profile" pathname={`/library/${LIBRARY}`}>
        <LibraryWindow startLetter={scenario.startLetter as 'A' | null} />
      </LibraryContentsProvider>,
    )
    await waitFor(() => expect(ids()).toHaveLength(scenario.pageSize))
    await waitFor(() => expect(socket.isLive('LibraryItemUpdated')).toBe(true))
    for (
      let count = scenario.pageSize;
      count < scenario.initialLoaded;
      count += scenario.pageSize
    ) {
      await user.click(screen.getByRole('button', { name: 'More' }))
      await waitFor(() => expect(ids()).toHaveLength(count + scenario.pageSize))
    }
    const publish = (item: typeof scenario.change) => {
      const payload = addition(item)
      payload.data.change.edge.orderKey = item.orderKey
      act(() => socket.publish('LibraryItemUpdated', payload))
    }
    publish(scenario.change)
    await waitFor(() => expect(ids()).toEqual(scenario.expectedChanged))
    saved = scenario.recovered
    recovered = true
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(ids()).toEqual(scenario.expectedRecovered)
      expect(screen.getByLabelText('Watch states')).not.toHaveTextContent('UNWATCHED')
    })
    publish(scenario.followUp)
    await waitFor(() => expect(ids()).toEqual(scenario.expectedFinal))
  })
})
