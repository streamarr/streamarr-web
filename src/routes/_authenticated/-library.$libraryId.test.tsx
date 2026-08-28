import { screen } from '@testing-library/react'
import { HttpResponse, graphql } from 'msw'
import { describe, expect, it } from 'vitest'
import type { MediaFilter, MediaSort } from '../../graphql/generated/graphql'
import { meFixture } from '../../test/meFixture'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'

const LIBRARY_ID = '44444444-4444-4444-4444-444444444444'
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
        pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
      },
    },
  }
}

function mockLibraryPage(capture: { libraryId?: string; sort?: MediaSort; filter?: MediaFilter }[]) {
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

  it('passes seeded search params through to the initial query', async () => {
    const requests: { libraryId?: string; sort?: MediaSort; filter?: MediaFilter }[] = []
    mockLibraryPage(requests)

    renderAppAt(`/library/${LIBRARY_ID}?by=TITLE&direction=ASC&watchStatus=UNWATCHED&letter=N`)

    await screen.findByRole('heading', { name: 'Movies' })
    expect(requests[0].sort).toEqual({ by: 'TITLE', direction: 'ASC' })
    expect(requests[0].filter?.watchStatus).toBe('UNWATCHED')
    expect(requests[0].filter?.startLetter).toBe('N')
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
