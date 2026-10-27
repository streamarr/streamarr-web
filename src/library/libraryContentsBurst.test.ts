import { ApolloLink, Observable, type ApolloClient } from '@apollo/client'
import type { FormattedExecutionResult } from 'graphql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApolloClient } from '../graphql/client'
import { LibraryPageDocument, type LibraryPageQuery } from '../graphql/generated/graphql'
import { definedEdges } from '../media/edges'
import { createLibraryContents } from './libraryContents'
import { LIBRARY, addition, edge } from '../test/libraryContentsFixtures'

const variables = { libraryId: LIBRARY, first: 48, sort: {}, filter: {} }
const query = { query: LibraryPageDocument, variables }

function libraryPage(titles: { id: string; title: string }[]): LibraryPageQuery {
  return {
    library: {
      ...{ __typename: 'Library' as const },
      id: LIBRARY,
      name: 'Movies',
      itemCount: titles.length,
      alphabetIndex: [],
      items: {
        edges: titles.map((title) => edge(title)),
        pageInfo: {
          hasPreviousPage: false,
          hasNextPage: false,
          startCursor: null,
          endCursor: null,
        },
      },
    },
  }
}

describe('Library contents during a scan', () => {
  let client: ApolloClient
  let contents: ReturnType<typeof createLibraryContents>
  const live = new Map<string, { next: (result: FormattedExecutionResult) => void }>()

  beforeEach(() => {
    vi.useFakeTimers()
    const subscriptions = new ApolloLink(
      (operation) =>
        new Observable((observer) => {
          live.set(operation.operationName ?? '', observer)
        }),
    )
    client = createApolloClient(() => {}, subscriptions)
    contents = createLibraryContents({ client })
  })

  afterEach(() => {
    contents.dispose()
    client.stop()
    live.clear()
    vi.useRealTimers()
  })

  async function showLibrary(titles: { id: string; title: string }[]) {
    client.cache.writeQuery({ ...query, data: libraryPage(titles) })
    const pages: LibraryPageQuery[] = []
    const screen = client.watchQuery(query).subscribe(({ data, dataState }) => {
      if (dataState === 'complete') pages.push(data)
    })
    const onItemsChanged = vi.fn()
    contents.select({ variables, onItemsChanged })
    await vi.runAllTimersAsync()
    return { pages, screen, onItemsChanged }
  }

  it('shouldApplyABurstOfLiveChangesAsOneChangeThatKeepsUntouchedTitles', async () => {
    const { pages, screen, onItemsChanged } = await showLibrary([
      { id: 'a', title: 'Alpha' },
      { id: 'c', title: 'Charlie' },
      { id: 'e', title: 'Echo' },
    ])
    const before = definedEdges(pages.at(-1)!.library.items.edges)

    live.get('LibraryItemAdded')!.next(addition({ id: 'b', title: 'Bravo' }))
    live.get('LibraryItemUpdated')!.next(addition({ id: 'b', title: 'Bravo' }))
    live.get('LibraryItemAdded')!.next(addition({ id: 'd', title: 'Delta' }))
    await vi.runAllTimersAsync()

    expect(onItemsChanged).toHaveBeenCalledOnce()
    expect(pages).toHaveLength(2)
    const after = definedEdges(pages[1].library.items.edges)
    expect(after.map((placed) => placed.node.title)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
      'Delta',
      'Echo',
    ])
    expect(after[0]).toBe(before[0])
    expect(after[2]).toBe(before[1])
    expect(after[4]).toBe(before[2])
    screen.unsubscribe()
  })

  it('shouldWriteALargeListAtMostOnceASecondWhileChangesKeepArriving', async () => {
    const loaded = Array.from({ length: 2000 }, (_, index) => ({
      id: `title-${index}`,
      title: `Title ${String(index).padStart(4, '0')}`,
    }))
    const { pages, screen, onItemsChanged } = await showLibrary(loaded)

    live.get('LibraryItemAdded')!.next(addition({ id: 'a', title: 'A first' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(onItemsChanged).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(100)
    live.get('LibraryItemAdded')!.next(addition({ id: 'z', title: 'Z last' }))
    await vi.advanceTimersByTimeAsync(899)
    expect(onItemsChanged).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(1)
    expect(onItemsChanged).toHaveBeenCalledTimes(2)
    await vi.runAllTimersAsync()
    const titles = definedEdges(pages.at(-1)!.library.items.edges).map(
      (placed) => placed.node.title,
    )
    expect(titles.at(-1)).toBe('Z last')
    screen.unsubscribe()
  })

  it('shouldApplyAQuickSecondChangeToASmallListWithoutWaiting', async () => {
    const { onItemsChanged, screen } = await showLibrary([{ id: 'a', title: 'Alpha' }])

    live.get('LibraryItemAdded')!.next(addition({ id: 'b', title: 'Bravo' }))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)
    live.get('LibraryItemAdded')!.next(addition({ id: 'c', title: 'Charlie' }))
    await vi.advanceTimersByTimeAsync(0)

    expect(onItemsChanged).toHaveBeenCalledTimes(2)
    screen.unsubscribe()
  })
})
