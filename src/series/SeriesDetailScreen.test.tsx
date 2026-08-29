import { screen, waitFor } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { SeriesDetailQuery } from '../graphql/generated/graphql'
import { meFixture } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

const ME = meFixture({ scope: 'profile' })

const TEAL_THEME = {
  base: '#0e3b34',
  panel: '#1a4740',
  selected: '#1f6b5a',
  accent: '#6fe0bf',
  onAccent: '#06231c',
  textPrimary: '#f2fcf8',
  textSecondary: '#8fb5aa',
}

function image(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Image',
    aspectRatio: 1.78,
    blurHash: null,
    ambientColors: null,
    variants: [{ id: 'v1', size: 'LARGE', width: 1920, height: 1080, url: 'backdrop.jpg' }],
    ...overrides,
  }
}

const COLORED = {
  topLeft: '#0d322c',
  topRight: '#0d322c',
  bottomRight: '#071f1b',
  bottomLeft: '#071f1b',
  primary: '#6fe0bf',
  theme: TEAL_THEME,
}

type Status = 'UNWATCHED' | 'IN_PROGRESS' | 'WATCHED'

function episode(number: number, status: Status = 'UNWATCHED', positionSeconds: number | null = null) {
  return {
    id: `s${number}`,
    episodeNumber: number,
    watchStatus: status,
    watchProgress: positionSeconds != null ? { positionSeconds } : null,
    files: [{ id: `file-e${number}` }],
  }
}

function season(number: number, episodes: ReturnType<typeof episode>[], overrides: Record<string, unknown> = {}) {
  const watched = episodes.every((entry) => entry.watchStatus === 'WATCHED')
  return {
    id: `season-${number}`,
    seasonNumber: number,
    title: `Season ${number}`,
    airDate: `${2016 + number}-07-21`,
    watchStatus: watched ? 'WATCHED' : episodes.some((entry) => entry.watchStatus !== 'UNWATCHED') ? 'IN_PROGRESS' : 'UNWATCHED',
    watchProgress: null,
    posterImages: [],
    episodes: episodes.map((entry) => ({ ...entry, id: `season-${number}-${entry.id}`, files: [{ id: `file-s${number}e${entry.episodeNumber}` }] })),
    ...overrides,
  }
}

function seriesData(overrides: Record<string, unknown> = {}): SeriesDetailQuery {
  return {
    series: {
      __typename: 'Series',
      id: 'series-1',
      title: 'Northern Line',
      tagline: 'Their last resort.',
      summary: 'A crime drama.',
      firstAirDate: '2017-07-21',
      contentRating: { value: 'TV-MA' },
      genres: [
        { id: 'g1', name: 'Crime' },
        { id: 'g2', name: 'Drama' },
      ],
      directors: [{ id: 'p1', name: 'Placeholder Creator' }],
      cast: [{ id: 'p2', name: 'Lead Actor', images: [] }],
      watchStatus: 'IN_PROGRESS',
      seasons: [
        season(1, [episode(1, 'WATCHED'), episode(2, 'WATCHED'), episode(3, 'WATCHED')]),
        season(2, [episode(4, 'UNWATCHED'), episode(5, 'IN_PROGRESS', 600)], { watchProgress: { percentComplete: 56 } }),
      ],
      backdropImages: [image({ ambientColors: COLORED })],
      posterImages: [],
      ...overrides,
    },
  } as SeriesDetailQuery
}

function serve(data: SeriesDetailQuery, requestedIds: string[] = []) {
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('SeriesDetail', ({ variables }) => {
      requestedIds.push(variables.id as string)
      return HttpResponse.json({ data })
    }),
  )
}

async function renderSeries(data: SeriesDetailQuery) {
  const rendered = renderAppAt('/series/series-1')
  serve(data)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Northern Line' })).toBeInTheDocument())
  return rendered
}

describe('SeriesDetailScreen', () => {
  it('shows an error state when the query fails', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('SeriesDetail', () => HttpResponse.json({ errors: [{ message: 'boom' }] })),
    )
    renderAppAt('/series/series-1')
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })

  it('queries the series named in the URL and renders its header', async () => {
    const requestedIds: string[] = []
    serve(seriesData(), requestedIds)
    renderAppAt('/series/series-1')

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Northern Line' })).toBeInTheDocument())
    expect(requestedIds).toEqual(['series-1'])
    expect(screen.getByText('Their last resort.')).toBeInTheDocument()
    expect(screen.getByText('A crime drama.')).toBeInTheDocument()
    expect(screen.getByText('Crime, Drama')).toBeInTheDocument()
    expect(screen.getByText('Created by')).toBeInTheDocument()
    expect(screen.getByText('Placeholder Creator')).toBeInTheDocument()
    expect(screen.getByText('21 Jul 2017')).toBeInTheDocument()
    expect(screen.getByText('TV-MA')).toBeInTheDocument()
    expect(screen.getByTestId('ambient-scope').style.getPropertyValue('--ambient-accent')).toBe('#6fe0bf')
  })

  it('resumes the in-progress episode at its saved position', async () => {
    serve(seriesData())
    renderAppAt('/series/series-1')
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Resume S2 E5' })).toHaveAttribute('href', '/play/file-s2e5?position=600'),
    )
  })

  it('continues with the next unwatched episode when nothing is mid-watch', async () => {
    serve(seriesData({ seasons: [season(1, [episode(1, 'WATCHED'), episode(2)])] }))
    renderAppAt('/series/series-1')
    await waitFor(() => expect(screen.getByRole('link', { name: 'Continue S1 E2' })).toHaveAttribute('href', '/play/file-s1e2'))
  })

  it('offers to play the first episode of an untouched series', async () => {
    serve(seriesData({ watchStatus: 'UNWATCHED', seasons: [season(1, [episode(1), episode(2)])] }))
    renderAppAt('/series/series-1')
    await waitFor(() => expect(screen.getByRole('link', { name: 'Play S1 E1' })).toHaveAttribute('href', '/play/file-s1e1'))
  })

  it('rolls watched episodes up into the progress divider', async () => {
    await renderSeries(seriesData())
    expect(screen.getByRole('progressbar', { name: '3 of 5 watched' })).toBeInTheDocument()
  })

  it('lists the seasons with a check when watched, otherwise the unwatched count and progress', async () => {
    const { container } = await renderSeries(seriesData())
    expect(screen.getByRole('heading', { name: 'Seasons' })).toBeInTheDocument()
    expect(screen.getByText('Season 1')).toBeInTheDocument()
    expect(screen.getByText('2017')).toBeInTheDocument()
    expect(screen.getByLabelText('Watched')).toBeInTheDocument()
    expect(screen.getByLabelText('2 unwatched')).toBeInTheDocument()
    expect(container.querySelector('[style*="width: 56%"]')).not.toBeNull()
  })

  it('confirms before marking the whole series watched, then flips the verb', async () => {
    let watched = false
    const markedIds: string[] = []
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('SeriesDetail', () => HttpResponse.json({ data: seriesData({ watchStatus: watched ? 'WATCHED' : 'IN_PROGRESS' }) })),
      graphql.mutation('MarkWatched', ({ variables }) => {
        markedIds.push(variables.id as string)
        watched = true
        return HttpResponse.json({ data: { markWatched: true } })
      }),
    )
    const { user } = renderAppAt('/series/series-1')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark series watched' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Mark series watched' }))
    expect(markedIds).toEqual([])
    expect(screen.getByRole('dialog', { name: 'Mark Northern Line as watched?' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mark watched' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark series unwatched' })).toBeInTheDocument())
    expect(markedIds).toEqual(['series-1'])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('confirms before marking the whole series unwatched, and cancelling changes nothing', async () => {
    const markedIds: string[] = []
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('SeriesDetail', () => HttpResponse.json({ data: seriesData({ watchStatus: 'WATCHED' }) })),
      graphql.mutation('MarkUnwatched', ({ variables }) => {
        markedIds.push(variables.id as string)
        return HttpResponse.json({ data: { markUnwatched: true } })
      }),
    )
    const { user } = renderAppAt('/series/series-1')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark series unwatched' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Mark series unwatched' }))
    expect(screen.getByRole('dialog', { name: 'Mark Northern Line as unwatched?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(markedIds).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Mark series unwatched' }))
    await user.click(screen.getByRole('button', { name: 'Mark unwatched' }))
    await waitFor(() => expect(markedIds).toEqual(['series-1']))
  })

  it('links each season card to its page', async () => {
    await renderSeries(seriesData())
    expect(screen.getByRole('link', { name: /Season 1/ })).toHaveAttribute('href', '/season/season-1')
    expect(screen.getByRole('link', { name: /Season 2/ })).toHaveAttribute('href', '/season/season-2')
  })

  it('lists the cast in a shelf when present', async () => {
    await renderSeries(seriesData())
    expect(screen.getByRole('heading', { name: 'Cast' })).toBeInTheDocument()
    expect(screen.getByText('Lead Actor')).toBeInTheDocument()
  })
})
