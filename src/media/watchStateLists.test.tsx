import { act, screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse, type GraphQLQuery } from 'msw'
import { describe, expect, it } from 'vitest'
import type { HomeQueryVariables, LibraryPageQueryVariables } from '../graphql/generated/graphql'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { meFixture, profileFixture } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

const MOVIES = '44444444-4444-4444-4444-444444444444'
const SHOWS = '55555555-5555-5555-5555-555555555555'
const WATCHER = meFixture({ scope: 'profile', profiles: [profileFixture({ selected: true })] })

type WatchStatus = 'WATCHED' | 'IN_PROGRESS' | 'UNWATCHED'

interface Title {
  id: string
  title: string
  libraryId: string
  watchStatus: WatchStatus
  lastWatchedAt: string | null
  unmatched: boolean
}

function title(id: string, name: string, overrides: Partial<Title> = {}): Title {
  return {
    id,
    title: name,
    libraryId: MOVIES,
    watchStatus: 'UNWATCHED',
    lastWatchedAt: null,
    unmatched: false,
    ...overrides,
  }
}

function progressOf({ watchStatus }: Title) {
  if (watchStatus !== 'IN_PROGRESS') return null
  return {
    __typename: 'WatchProgress',
    positionSeconds: 600,
    percentComplete: 10,
    durationSeconds: 6000,
  }
}

function card(movie: Title) {
  return {
    __typename: 'Movie',
    id: movie.id,
    title: movie.title,
    titleSort: movie.title,
    releaseDate: '2024-01-01',
    runtime: 100,
    lastWatchedAt: movie.lastWatchedAt,
    watchStatus: movie.watchStatus,
    watchProgress: progressOf(movie),
    images: [],
  }
}

function continueWatchingCard(movie: Title) {
  return {
    __typename: 'Movie',
    id: movie.id,
    title: movie.title,
    tagline: null,
    summary: null,
    runtime: 100,
    createdOn: '2026-08-26T12:00:00Z',
    lastWatchedAt: movie.lastWatchedAt,
    genres: [],
    images: [],
    watchProgress: progressOf(movie),
    files: [{ __typename: 'MediaFile', id: `file-${movie.id}` }],
  }
}

// A Home rail caches every field a Continue Watching card shows for its titles.
function recentlyAddedRail(titles: Title[]) {
  return {
    __typename: 'Library',
    id: MOVIES,
    name: 'Movies',
    type: 'MOVIE',
    items: {
      edges: titles.map((each) => {
        const { images, ...shown } = continueWatchingCard(each)
        return {
          cursor: each.id,
          node: { ...card(each), ...shown, backdropImages: images },
        }
      }),
    },
  }
}

// The item a watch-state change carries for a movie: its card fields and its watch state.
function changed(movie: Title) {
  return {
    ...card(movie),
    unmatched: movie.unmatched,
    library: { __typename: 'Library', id: movie.libraryId },
  }
}

function byTitle(a: Title, b: Title) {
  return a.title.localeCompare(b.title)
}

function byLastWatchedNewestFirst(a: Title, b: Title) {
  return (b.lastWatchedAt ?? '').localeCompare(a.lastWatchedAt ?? '')
}

// Plays a server that holds each title's watch state. A test saves a change, then publishes it,
// so a read that lands after the change answers with the same state the change carried.
function serve(titles: Title[], { pageSize = 48, recentlyAdded = [] as Title[] } = {}) {
  let current: LibraryPageQueryVariables | undefined
  const orderKey = (item: Title) =>
    current?.sort?.by === 'LAST_WATCHED'
      ? `${item.lastWatchedAt ? String(9999999999999 - Date.parse(item.lastWatchedAt)).padStart(13, '0') : 'Z'}:${item.id}`
      : item.title
  const saved = new Map(titles.map((each) => [each.id, each]))
  const reads: Record<string, number> = {}
  const count = (operationName: string) => {
    reads[operationName] = (reads[operationName] ?? 0) + 1
  }
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: WATCHER } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
      current = variables
      count('LibraryPage')
      const order = variables.sort?.by === 'LAST_WATCHED' ? byLastWatchedNewestFirst : byTitle
      const members = [...saved.values()]
        .filter((each) => each.libraryId === variables.libraryId)
        .filter(
          (each) =>
            !variables.filter?.watchStatus || each.watchStatus === variables.filter.watchStatus,
        )
        .sort(order)
      const start = variables.after
        ? members.findIndex((each) => each.id === variables.after) + 1
        : 0
      const page = members.slice(start, start + pageSize)
      return HttpResponse.json({
        data: {
          library: {
            __typename: 'Library',
            id: variables.libraryId,
            name: 'Movies',
            status: 'HEALTHY',
            scanCompletedOn: '2026-08-28T11:46:00Z',
            itemCount: saved.size,
            alphabetIndex: [],
            items: {
              edges: page.map((each) => ({
                cursor: each.id,
                orderKey: orderKey(each),
                node: card(each),
              })),
              pageInfo: {
                hasNextPage: start + pageSize < members.length,
                hasPreviousPage: start > 0,
                startCursor: page[0]?.id ?? null,
                endCursor: page.at(-1)?.id ?? null,
              },
            },
          },
        },
      })
    }),
    graphql.query<GraphQLQuery, HomeQueryVariables>('Home', ({ variables }) => {
      count('Home')
      const continueWatching = [...saved.values()]
        .filter((each) => each.watchStatus === 'IN_PROGRESS')
        .sort(byLastWatchedNewestFirst)
        .slice(0, variables.continueWatchingFirst)
        .map(continueWatchingCard)
      const libraries = recentlyAdded.length === 0 ? [] : [recentlyAddedRail(recentlyAdded)]
      return HttpResponse.json({ data: { continueWatching, libraries } })
    }),
  )
  const socket = serveGraphqlSocket()
  return {
    reads,
    socket,
    save(...changes: Title[]) {
      for (const each of changes) {
        saved.set(each.id, each)
        socket.publish('LibraryItemUpdated', {
          data: {
            change: {
              __typename: 'LibraryItemChange',
              libraryId: each.libraryId,
              itemId: each.id,
              kind: 'MOVIE',
              item: card(each),
              position: {
                __typename: 'LibraryItemPosition',
                matchesFilter:
                  !each.unmatched &&
                  (!current?.filter?.watchStatus ||
                    current.filter.watchStatus === each.watchStatus),
                cursor: each.id,
                orderKey: orderKey(each),
              },
            },
          },
        })
      }
      socket.publish('WatchStateChanged', {
        data: {
          watchStateChanged: { __typename: 'WatchStateChange', items: changes.map(changed) },
        },
      })
    },
  }
}

async function open(path: string, socket: ReturnType<typeof serveGraphqlSocket>, first: RegExp) {
  const rendered = renderAppAt(path)
  await screen.findByRole('link', { name: first })
  await waitFor(() => expect(socket.isLive('WatchStateChanged')).toBe(true))
  if (path.startsWith('/library/'))
    await waitFor(() => expect(socket.isLive('LibraryItemUpdated')).toBe(true))
  return rendered
}

const TITLES = ['Everlight', 'Northern Line', 'Northern Lights', 'Ocean', 'Zenith']

// Each link's title, in the order the page shows them; a card also shows its year or time left.
function titlesIn(links: HTMLElement[]) {
  return links.map((link) => TITLES.find((name) => link.textContent?.startsWith(name)) ?? '')
}

function shownTitles() {
  const grid = screen.queryByRole('grid', { name: 'Items' })
  return grid ? titlesIn(within(grid).queryAllByRole('link')) : []
}

function shelfLinks() {
  const shelf = screen.queryByRole('heading', { name: 'Continue watching' })?.closest('section')
  return shelf ? within(shelf).queryAllByRole('link') : []
}

function continueWatchingTitles() {
  return titlesIn(shelfLinks())
}

const EVERLIGHT = title('m1', 'Everlight')
const NORTHERN_LINE = title('m2', 'Northern Line')
const OCEAN = title('m3', 'Ocean')

describe('watch-state lists', () => {
  it('shouldDropAMovieThatTurnsWatchedFromTheUnwatchedViewWithoutReadingItAgain', async () => {
    const { reads, socket, save } = serve([EVERLIGHT, NORTHERN_LINE])
    await open(`/library/${MOVIES}?watchStatus=UNWATCHED`, socket, /Everlight/)
    const readsBeforeChange = { ...reads }

    save({ ...EVERLIGHT, watchStatus: 'WATCHED', lastWatchedAt: '2026-10-16T10:00:00Z' })

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Everlight/ })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('link', { name: /Northern Line/ })).toBeVisible()
    expect(reads).toEqual(readsBeforeChange)
  })

  it('shouldTakeInAMovieThatGainsProgressAtItsTitlePositionInTheInProgressView', async () => {
    const watching = { watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T09:00:00Z' } as const
    const { reads, socket, save } = serve([
      { ...EVERLIGHT, ...watching },
      NORTHERN_LINE,
      { ...OCEAN, ...watching },
    ])
    await open(`/library/${MOVIES}?watchStatus=IN_PROGRESS`, socket, /Everlight/)
    const readsBeforeChange = { ...reads }

    save({ ...NORTHERN_LINE, watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T10:00:00Z' })

    await screen.findByRole('link', { name: /Northern Line/ })
    expect(shownTitles()).toEqual(['Everlight', 'Northern Line', 'Ocean'])
    expect(reads).toEqual(readsBeforeChange)
  })

  it('shouldDropAMovieThatCompletesFromTheInProgressView', async () => {
    const watching = { watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T09:00:00Z' } as const
    const { socket, save } = serve([
      { ...EVERLIGHT, ...watching },
      { ...OCEAN, ...watching },
    ])
    await open(`/library/${MOVIES}?watchStatus=IN_PROGRESS`, socket, /Everlight/)

    save({ ...EVERLIGHT, watchStatus: 'WATCHED', lastWatchedAt: '2026-10-16T10:00:00Z' })

    await waitFor(() => expect(shownTitles()).toEqual(['Ocean']))
  })

  it('shouldMoveARewatchedMovieToTheHeadOfTheLastWatchedView', async () => {
    const { reads, socket, save } = serve([
      { ...EVERLIGHT, watchStatus: 'WATCHED', lastWatchedAt: '2026-10-16T09:00:00Z' },
      { ...NORTHERN_LINE, watchStatus: 'WATCHED', lastWatchedAt: '2026-10-16T08:00:00Z' },
      OCEAN,
    ])
    await open(`/library/${MOVIES}?by=LAST_WATCHED&direction=DESC`, socket, /Everlight/)
    expect(shownTitles()).toEqual(['Everlight', 'Northern Line', 'Ocean'])
    const readsBeforeChange = { ...reads }

    save({ ...NORTHERN_LINE, watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T10:00:00Z' })

    await waitFor(() => expect(shownTitles()).toEqual(['Northern Line', 'Everlight', 'Ocean']))
    expect(reads).toEqual(readsBeforeChange)
  })

  it('shouldBringAMovieFromAnUnloadedPageToTheHeadOfTheLastWatchedView', async () => {
    const { socket, save } = serve(
      [
        { ...EVERLIGHT, watchStatus: 'WATCHED', lastWatchedAt: '2026-10-16T09:00:00Z' },
        { ...NORTHERN_LINE, watchStatus: 'WATCHED', lastWatchedAt: '2026-10-16T08:00:00Z' },
        OCEAN,
      ],
      { pageSize: 2 },
    )
    await open(`/library/${MOVIES}?by=LAST_WATCHED&direction=DESC`, socket, /Everlight/)
    expect(shownTitles()).toEqual(['Everlight', 'Northern Line'])

    save({ ...OCEAN, watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T10:00:00Z' })

    await waitFor(() => expect(shownTitles()).toEqual(['Ocean', 'Everlight', 'Northern Line']))
  })

  it('shouldKeepTheLastLoadedMovieWhenAChangeRepeatsItsLastWatched', async () => {
    const northernLine = {
      ...NORTHERN_LINE,
      watchStatus: 'WATCHED',
      lastWatchedAt: '2026-10-16T08:00:00Z',
    } as const
    const { socket, save } = serve(
      [
        { ...EVERLIGHT, watchStatus: 'WATCHED', lastWatchedAt: '2026-10-16T09:00:00Z' },
        northernLine,
        OCEAN,
      ],
      { pageSize: 2 },
    )
    await open(`/library/${MOVIES}?by=LAST_WATCHED&direction=DESC`, socket, /Everlight/)

    save(northernLine)
    // Moving past the loaded range removes the title without filling its place.
    save({ ...EVERLIGHT, watchStatus: 'WATCHED', lastWatchedAt: '2026-10-16T07:30:00Z' })

    await waitFor(() => expect(shownTitles()).toEqual(['Northern Line']))
  })

  it('shouldLeaveAMovieThatBelongsPastTheLoadedPagesForPagination', async () => {
    const watching = { watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T09:00:00Z' } as const
    const zenith = title('m9', 'Zenith')
    const { socket, save } = serve(
      [
        { ...EVERLIGHT, ...watching },
        { ...NORTHERN_LINE, ...watching },
        { ...OCEAN, ...watching },
        zenith,
      ],
      { pageSize: 2 },
    )
    await open(`/library/${MOVIES}?watchStatus=IN_PROGRESS`, socket, /Everlight/)

    save({ ...zenith, watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T10:00:00Z' })
    // Dropping a title shrinks the loaded page without reading a replacement.
    save({ ...EVERLIGHT, watchStatus: 'WATCHED', lastWatchedAt: '2026-10-16T10:01:00Z' })

    // Both titles beyond the loaded range wait for ordinary pagination.
    await waitFor(() => expect(shownTitles()).toEqual(['Northern Line']))
  })

  it('shouldNeverInsertAnUnmatchedMovieIntoALibraryView', async () => {
    const watching = { watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T09:00:00Z' } as const
    const { socket, save } = serve([
      { ...EVERLIGHT, ...watching },
      { ...NORTHERN_LINE, unmatched: true },
      { ...OCEAN, ...watching },
    ])
    await open(`/library/${MOVIES}?watchStatus=IN_PROGRESS`, socket, /Everlight/)

    save(
      { ...NORTHERN_LINE, unmatched: true, ...watching },
      { ...OCEAN, watchStatus: 'WATCHED', lastWatchedAt: '2026-10-16T10:00:00Z' },
    )

    await waitFor(() => expect(shownTitles()).toEqual(['Everlight']))
  })

  it('shouldIgnoreAChangeToAMovieOfAnotherLibrary', async () => {
    const watching = { watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T09:00:00Z' } as const
    const elsewhere = title('s1', 'Northern Lights', { libraryId: SHOWS })
    const { socket, save } = serve([
      { ...EVERLIGHT, ...watching },
      elsewhere,
      { ...OCEAN, ...watching },
    ])
    await open(`/library/${MOVIES}?watchStatus=IN_PROGRESS`, socket, /Everlight/)

    save(
      { ...elsewhere, ...watching },
      { ...OCEAN, watchStatus: 'WATCHED', lastWatchedAt: '2026-10-16T10:00:00Z' },
    )

    await waitFor(() => expect(shownTitles()).toEqual(['Everlight']))
  })

  it('shouldShowAMovieOnceWhenTheSameChangeArrivesTwice', async () => {
    const watching = { watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T09:00:00Z' } as const
    const { socket, save } = serve([{ ...EVERLIGHT, ...watching }, NORTHERN_LINE])
    await open(`/library/${MOVIES}?watchStatus=IN_PROGRESS`, socket, /Everlight/)
    const started = { ...NORTHERN_LINE, ...watching, lastWatchedAt: '2026-10-16T10:00:00Z' }

    save(started)
    save(started)

    await screen.findByRole('link', { name: /Northern Line/ })
    await act(async () => {})
    expect(shownTitles()).toEqual(['Everlight', 'Northern Line'])
  })

  it('shouldKeepAnUnwatchedViewCurrentAcrossDetailAndBack', async () => {
    const { reads, socket, save } = serve([EVERLIGHT, NORTHERN_LINE])
    server.use(
      graphql.query('MovieDetail', () =>
        HttpResponse.json({
          data: {
            movie: {
              __typename: 'Movie',
              id: 'm2',
              title: 'Northern Line',
              tagline: null,
              summary: null,
              runtime: 100,
              releaseDate: '2024-01-01',
              contentRating: null,
              genres: [],
              directors: [],
              cast: [],
              ratings: [],
              files: [],
              watchStatus: 'UNWATCHED',
              watchProgress: null,
              backdropImages: [],
              posterImages: [],
            },
          },
        }),
      ),
    )
    const { router } = await open(`/library/${MOVIES}?watchStatus=UNWATCHED`, socket, /Everlight/)
    await act(async () => {
      await router.navigate({ to: '/movie/$movieId', params: { movieId: 'm2' } })
    })
    await screen.findByRole('button', { name: 'Mark watched' })
    const libraryReads = reads.LibraryPage

    save({ ...EVERLIGHT, watchStatus: 'WATCHED', lastWatchedAt: '2026-10-16T10:00:00Z' })
    // The detail's own change shows that the earlier one has been applied.
    save({ ...NORTHERN_LINE, watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T10:01:00Z' })
    await screen.findByRole('button', { name: 'Mark watched' })
    await act(async () => {
      router.history.back()
    })

    await waitFor(() => expect(reads.LibraryPage).toBe(libraryReads))
    await waitFor(() => expect(shownTitles()).toEqual([]))
  })

  describe('Continue Watching', () => {
    it('shouldMoveATitleWithNewProgressToTheHeadWithoutReadingHomeAgain', async () => {
      const { reads, socket, save } = serve([
        { ...EVERLIGHT, watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T09:00:00Z' },
        { ...NORTHERN_LINE, watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T08:00:00Z' },
      ])
      await open('/', socket, /Everlight/)
      expect(continueWatchingTitles()).toEqual(['Everlight', 'Northern Line'])
      const readsBeforeChange = { ...reads }

      save({ ...NORTHERN_LINE, watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T10:00:00Z' })

      await waitFor(() => expect(continueWatchingTitles()).toEqual(['Northern Line', 'Everlight']))
      expect(reads).toEqual(readsBeforeChange)
    })

    it('shouldDropACompletedTitleWithoutReadingHomeAgain', async () => {
      const { reads, socket, save } = serve([
        { ...EVERLIGHT, watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T09:00:00Z' },
        { ...NORTHERN_LINE, watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T08:00:00Z' },
      ])
      await open('/', socket, /Everlight/)
      const readsBeforeChange = { ...reads }

      save({ ...EVERLIGHT, watchStatus: 'WATCHED', lastWatchedAt: '2026-10-16T10:00:00Z' })

      await waitFor(() => expect(continueWatchingTitles()).toEqual(['Northern Line']))
      expect(reads).toEqual(readsBeforeChange)
    })

    it.each(['WATCHED', 'IN_PROGRESS'] as const)(
      'shouldShrinkAFullShelfWithoutReadingHomeWhenATitleLeavesItsRangeAs%s',
      async (watchStatus) => {
        const full = Array.from({ length: 13 }, (_, index) =>
          title(`w${index}`, index === 0 ? 'Everlight' : `Title ${index}`, {
            watchStatus: 'IN_PROGRESS',
            lastWatchedAt: `2026-10-16T09:${String(59 - index).padStart(2, '0')}:00Z`,
          }),
        )
        const { reads, socket, save } = serve(full)
        await open('/', socket, /Everlight/)
        const homeReads = reads.Home

        save({ ...full[0], watchStatus, lastWatchedAt: '2026-10-15T10:00:00Z' })

        await waitFor(() => expect(shelfLinks()).toHaveLength(11))
        expect(
          shelfLinks().map((link) => within(link).getByText(/^Title \d+$/).textContent),
        ).toEqual([
          'Title 1',
          'Title 2',
          'Title 3',
          'Title 4',
          'Title 5',
          'Title 6',
          'Title 7',
          'Title 8',
          'Title 9',
          'Title 10',
          'Title 11',
        ])
        expect(reads.Home).toBe(homeReads)
      },
    )

    it('shouldKeepAFullShelfAtItsLimitWhenATitleStartsAtTheHead', async () => {
      const full = Array.from({ length: 12 }, (_, index) =>
        title(`w${index}`, index === 0 ? 'Everlight' : `Title ${index}`, {
          watchStatus: 'IN_PROGRESS',
          lastWatchedAt: `2026-10-16T09:${String(59 - index).padStart(2, '0')}:00Z`,
        }),
      )
      const { reads, socket, save } = serve([...full, NORTHERN_LINE], {
        recentlyAdded: [NORTHERN_LINE],
      })
      await open('/', socket, /Everlight/)
      const readsBeforeChange = { ...reads }

      save({ ...NORTHERN_LINE, watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T10:00:00Z' })

      await waitFor(() => expect(continueWatchingTitles()[0]).toBe('Northern Line'))
      expect(shelfLinks()).toHaveLength(12)
      expect(reads).toEqual(readsBeforeChange)
    })

    it('shouldReadHomeAgainWhenATitleItHasNotLoadedStarts', async () => {
      const { reads, socket, save } = serve([
        { ...EVERLIGHT, watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T09:00:00Z' },
        NORTHERN_LINE,
      ])
      await open('/', socket, /Everlight/)
      const homeReads = reads.Home

      save({ ...NORTHERN_LINE, watchStatus: 'IN_PROGRESS', lastWatchedAt: '2026-10-16T10:00:00Z' })

      await waitFor(() => expect(continueWatchingTitles()).toEqual(['Northern Line', 'Everlight']))
      expect(reads.Home).toBe(homeReads + 1)
    })
  })
})
