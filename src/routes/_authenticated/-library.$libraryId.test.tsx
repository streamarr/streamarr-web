import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse, graphql, type GraphQLQuery } from 'msw'
import { describe, expect, it } from 'vitest'
import type {
  LibraryPageQueryVariables,
  MediaFilter,
  MediaSort,
  MovieDetailQuery,
} from '../../graphql/generated/graphql'
import styles from '../../library/LibraryScreen.module.css'
import { meFixture } from '../../test/meFixture'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'
import { JSDOM_ROW_HEIGHT } from '../../../vitest.setup'

const LIBRARY_ID = '44444444-4444-4444-4444-444444444444'
// alphabetIndex offers only these letters, so the rail renders exactly these buttons.
const RAIL_LETTERS = ['A', 'N', 'T']
const ME = meFixture({ scope: 'profile' })

function libraryData() {
  return {
    library: {
      id: LIBRARY_ID,
      name: 'Movies',
      status: 'HEALTHY',
      scanCompletedOn: '2026-08-28T11:46:00Z',
      alphabetIndex: [{ letter: 'A', count: 1 }],
      items: {
        edges: [],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: null,
          endCursor: null,
        },
      },
    },
  }
}

const EVERLIGHT_CARD = {
  __typename: 'Movie',
  id: 'm1',
  title: 'Everlight',
  titleSort: 'Everlight',
  releaseDate: '2024-01-01',
  runtime: 100,
  watchStatus: 'UNWATCHED',
  watchProgress: null,
  images: [],
}

const EVERLIGHT_DETAIL: MovieDetailQuery = {
  movie: {
    __typename: 'Movie',
    id: 'm1',
    title: 'Everlight',
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
} as MovieDetailQuery

function titleCard(id: string, title: string) {
  return { ...EVERLIGHT_CARD, id, title, titleSort: title }
}

// A title-sorted page whose cursors are the ids.
function titlePage(cards: ReturnType<typeof titleCard>[]) {
  const data = libraryData()
  return {
    library: {
      ...data.library,
      alphabetIndex: RAIL_LETTERS.map((letter) => ({ letter, count: 1 })),
      items: {
        edges: cards.map((node) => ({ cursor: node.id, node })),
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: cards[0]?.id ?? null,
          endCursor: cards.at(-1)?.id ?? null,
        },
      },
    },
  }
}

function gate() {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  return { pending, release }
}

function libraryWithEverlight() {
  const data = libraryData()
  return {
    library: {
      ...data.library,
      items: {
        edges: [{ cursor: 'c1', node: EVERLIGHT_CARD }],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: 'c1',
          endCursor: 'c1',
        },
      },
    },
  }
}

function mockLibraryPage(
  capture: { libraryId?: string; sort?: MediaSort; filter?: MediaFilter }[],
) {
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('LibraryPage', ({ variables }) => {
      capture.push({
        libraryId: variables.libraryId as string,
        sort: variables.sort as MediaSort,
        filter: variables.filter as MediaFilter,
      })
      return HttpResponse.json({ data: libraryData() })
    }),
  )
}

describe('/library/$libraryId', () => {
  it('shouldRefreshAnEmptyFilteredLibraryAfterMarkingATitleUnwatched', async () => {
    let watched = true
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('LibraryPage', () => {
        const data = watched ? libraryData() : libraryWithEverlight()
        return HttpResponse.json({ data: { library: { ...data.library, __typename: 'Library' } } })
      }),
      graphql.query('MovieDetail', () =>
        HttpResponse.json({
          data: {
            movie: { ...EVERLIGHT_DETAIL.movie, watchStatus: watched ? 'WATCHED' : 'UNWATCHED' },
          },
        }),
      ),
      graphql.mutation('MarkUnwatched', () => {
        watched = false
        return HttpResponse.json({ data: { markUnwatched: true } })
      }),
    )
    const { user, router } = renderAppAt(`/library/${LIBRARY_ID}?watchStatus=UNWATCHED`)
    await screen.findByText('No items match this filter.')
    await act(async () => {
      await router.navigate({ to: '/movie/$movieId', params: { movieId: 'm1' } })
    })
    await user.click(await screen.findByRole('button', { name: 'Mark unwatched' }))
    await screen.findByRole('button', { name: 'Mark watched' })
    await act(async () => {
      router.history.back()
    })
    expect(await screen.findByRole('link', { name: /Everlight/ })).toBeVisible()
  })

  it('queries the id from the route param with the default sort when no search params are given', async () => {
    const requests: { libraryId?: string; sort?: MediaSort; filter?: MediaFilter }[] = []
    mockLibraryPage(requests)

    renderAppAt(`/library/${LIBRARY_ID}`)

    await screen.findByRole('heading', { name: 'Movies' })
    expect(requests[0].libraryId).toBe(LIBRARY_ID)
    expect(requests[0].sort).toEqual({ by: 'ADDED', direction: 'DESC' })
    expect(requests[0].filter?.watchStatus).toBeUndefined()
    expect(requests[0].filter?.startLetter).toBeUndefined()
  })

  it('passes a seeded title-sort letter jump through to the initial query', async () => {
    const requests: { libraryId?: string; sort?: MediaSort; filter?: MediaFilter }[] = []
    mockLibraryPage(requests)

    renderAppAt(`/library/${LIBRARY_ID}?by=TITLE&direction=ASC&letter=N`)

    await screen.findByRole('heading', { name: 'Movies' })
    expect(requests[0].sort).toEqual({ by: 'TITLE', direction: 'ASC' })
    expect(requests[0].filter?.watchStatus).toBeUndefined()
    expect(requests[0].filter?.startLetter).toBe('N')
  })

  it('keeps the grid position when returning from a title', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('LibraryPage', () => HttpResponse.json({ data: libraryWithEverlight() })),
      graphql.query('MovieDetail', () => HttpResponse.json({ data: EVERLIGHT_DETAIL })),
    )
    const { router, user } = renderAppAt(`/library/${LIBRARY_ID}`)
    const card = await screen.findByRole('link', { name: /Everlight/ })
    const grid = document.querySelector(`.${styles.grid}`) as HTMLElement
    grid.scrollTop = 1500
    fireEvent.scroll(grid)

    await user.click(card)
    await screen.findByRole('heading', { level: 1, name: 'Everlight' })
    act(() => router.history.back())

    await screen.findByRole('link', { name: /Everlight/ })
    await waitFor(() =>
      expect(document.querySelector(`.${styles.grid}`)).toHaveProperty('scrollTop', 1500),
    )
  })

  it('keeps the grid on screen while a letter jump is in flight', async () => {
    const seek = gate()
    let seekRequested = false
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>(
        'LibraryPage',
        async ({ variables }) => {
          if (variables.filter?.startLetter === 'N') {
            seekRequested = true
            await seek.pending
            return HttpResponse.json({ data: titlePage([titleCard('m-n', 'Northern Line')]) })
          }
          return HttpResponse.json({ data: titlePage([titleCard('m-a', 'Alright')]) })
        },
      ),
    )
    const { user } = renderAppAt(`/library/${LIBRARY_ID}?by=TITLE&direction=ASC`)
    await screen.findByRole('link', { name: /Alright/ })
    const grid = document.querySelector(`.${styles.grid}`)

    await user.click(screen.getByRole('button', { name: 'N' }))

    await waitFor(() => expect(seekRequested).toBe(true))
    expect(grid).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Alright/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Movies' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unwatched' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Jump to letter' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'N' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('No items match this filter.')).not.toBeInTheDocument()

    seek.release()

    const landing = await screen.findByRole('link', { name: /Northern Line/ })
    expect(grid).toContainElement(landing)
  })

  it('keeps the grid and the viewed letter when a letter jump fails, and retries from the alert', async () => {
    let seekAttempts = 0
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) => {
        if (variables.filter?.startLetter !== 'N') {
          return HttpResponse.json({ data: titlePage([titleCard('m-a', 'Alright')]) })
        }
        seekAttempts += 1
        if (seekAttempts === 1) {
          return HttpResponse.json({ errors: [{ message: 'Library unavailable' }] })
        }
        return HttpResponse.json({ data: titlePage([titleCard('m-n', 'Northern Line')]) })
      }),
    )
    const { user } = renderAppAt(`/library/${LIBRARY_ID}?by=TITLE&direction=ASC`)
    const alright = await screen.findByRole('link', { name: /Alright/ })
    const grid = document.querySelector(`.${styles.grid}`)
    // The A row is the topmost row in view, so the rail highlights A.
    expect(grid).toContainElement(alright)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-pressed', 'true'),
    )

    await user.click(screen.getByRole('button', { name: 'N' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Library unavailable')
    expect(grid).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Alright/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'N' })).toHaveAttribute('aria-pressed', 'false')

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    const landing = await screen.findByRole('link', { name: /Northern Line/ })
    expect(grid).toContainElement(landing)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('lands on the last letter pressed when a second press arrives mid-jump', async () => {
    const seeks = { N: gate(), T: gate() }
    const requested: string[] = []
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>(
        'LibraryPage',
        async ({ variables }) => {
          const letter = variables.filter?.startLetter
          if (letter === 'N' || letter === 'T') {
            requested.push(letter)
            await seeks[letter].pending
            const title = letter === 'N' ? 'Northern Line' : 'Tundra'
            return HttpResponse.json({ data: titlePage([titleCard(`m-${letter}`, title)]) })
          }
          return HttpResponse.json({ data: titlePage([titleCard('m-a', 'Alright')]) })
        },
      ),
    )
    const { router, user } = renderAppAt(`/library/${LIBRARY_ID}?by=TITLE&direction=ASC`)
    await screen.findByRole('link', { name: /Alright/ })
    const grid = document.querySelector(`.${styles.grid}`)

    await user.click(screen.getByRole('button', { name: 'N' }))
    await waitFor(() => expect(requested).toEqual(['N']))
    await user.click(screen.getByRole('button', { name: 'T' }))
    await waitFor(() => expect(requested).toEqual(['N', 'T']))
    expect(screen.getByRole('button', { name: 'T' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: /Alright/ })).toBeInTheDocument()
    seeks.N.release()
    seeks.T.release()

    const landing = await screen.findByRole('link', { name: /Tundra/ })
    expect(grid).toContainElement(landing)
    expect(screen.queryByRole('link', { name: /Northern Line/ })).not.toBeInTheDocument()
    expect(router.state.location.search).toMatchObject({ letter: 'T' })
  })

  it('returns focus to the letter on a keyboard repeat-press, and leaves it with the pointer afterwards', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('LibraryPage', () =>
        HttpResponse.json({
          data: titlePage([titleCard('m-a', 'Apple'), titleCard('m-n', 'Northern')]),
        }),
      ),
    )
    const { user } = renderAppAt(`/library/${LIBRARY_ID}?by=TITLE&direction=ASC&letter=A`)
    const apple = await screen.findByRole('link', { name: /Apple/ })
    // Scrolled to Northern's row, the rail follows the grid, and A is a letter to return to.
    const grid = document.querySelector(`.${styles.grid}`) as HTMLElement
    grid.scrollTop = JSDOM_ROW_HEIGHT
    fireEvent.scroll(grid)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'N' })).toHaveAttribute('aria-pressed', 'true'),
    )

    act(() => screen.getByRole('button', { name: 'A' }).focus())
    await user.keyboard('{Enter}')
    await waitFor(() => expect(apple).toHaveFocus())

    await user.click(screen.getByRole('button', { name: /Sort:/ }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Title' }))
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await act(async () => {})

    expect(screen.getByRole('link', { name: /Apple/ })).not.toHaveFocus()
    expect(document.body).toHaveFocus()
  })

  it('starts the grid at the top when the sort changes', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query<GraphQLQuery, LibraryPageQueryVariables>('LibraryPage', ({ variables }) =>
        HttpResponse.json({
          data:
            variables.sort?.by === 'ADDED'
              ? titlePage([titleCard('m-r', 'Recent Arrival')])
              : titlePage([titleCard('m-a', 'Alright')]),
        }),
      ),
    )
    const { user } = renderAppAt(`/library/${LIBRARY_ID}?by=TITLE&direction=ASC`)
    await screen.findByRole('link', { name: /Alright/ })
    const grid = document.querySelector(`.${styles.grid}`) as HTMLElement
    grid.scrollTop = 1500

    await user.click(screen.getByRole('button', { name: /Sort:/ }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Recently added' }))

    await screen.findByRole('link', { name: /Recent Arrival/ })
    expect(grid.scrollTop).toBe(0)
  })

  it('falls back to the default sort when a search param is not a recognized value', async () => {
    const requests: { libraryId?: string; sort?: MediaSort; filter?: MediaFilter }[] = []
    mockLibraryPage(requests)

    renderAppAt(`/library/${LIBRARY_ID}?by=BOGUS&direction=SIDEWAYS&watchStatus=BINGED`)

    await screen.findByRole('heading', { name: 'Movies' })
    expect(requests[0].sort).toEqual({ by: 'ADDED', direction: 'DESC' })
    expect(requests[0].filter?.watchStatus).toBeUndefined()
  })
})
