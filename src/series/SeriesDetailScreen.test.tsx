import { screen, waitFor } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { SeriesDetailQuery } from '../graphql/generated/graphql'
import { deferred } from '../test/deferred'
import { meFixture } from '../test/meFixture'
import {
  answersInTurn,
  answersThenHolds,
  answerWith,
  comeBackOnline,
  comeBackOnlineUntil,
  failsOnceThen,
  heldAnswer,
  invalidIdResponse,
  serverFailure,
} from '../test/graphqlResponses'
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

function episode(
  number: number,
  status: Status = 'UNWATCHED',
  positionSeconds: number | null = null,
) {
  return {
    __typename: 'Episode',
    id: `s${number}`,
    episodeNumber: number,
    watchStatus: status,
    watchProgress: positionSeconds != null ? { positionSeconds } : null,
    files: [{ id: `file-e${number}` }],
  }
}

function season(
  number: number,
  episodes: ReturnType<typeof episode>[],
  overrides: Record<string, unknown> = {},
) {
  const watched = episodes.every((entry) => entry.watchStatus === 'WATCHED')
  return {
    __typename: 'Season',
    id: `season-${number}`,
    seasonNumber: number,
    title: `Season ${number}`,
    airDate: `${2016 + number}-07-21`,
    watchStatus: watched
      ? 'WATCHED'
      : episodes.some((entry) => entry.watchStatus !== 'UNWATCHED')
        ? 'IN_PROGRESS'
        : 'UNWATCHED',
    watchProgress: null,
    posterImages: [],
    episodes: episodes.map((entry) => ({
      ...entry,
      id: `season-${number}-${entry.id}`,
      files: [{ id: `file-s${number}e${entry.episodeNumber}` }],
    })),
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
        season(2, [episode(4, 'UNWATCHED'), episode(5, 'IN_PROGRESS', 600)], {
          watchProgress: { percentComplete: 56 },
        }),
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
  await waitFor(() =>
    expect(screen.getByRole('heading', { level: 1, name: 'Northern Line' })).toBeInTheDocument(),
  )
  return rendered
}

describe('SeriesDetailScreen', () => {
  it('shouldContinueWithAnAvailableEpisodeWhenEarlierEpisodesHaveNoFiles', async () => {
    serve(
      seriesData({
        seasons: [
          season(1, [], {
            episodes: [
              { ...episode(1, 'WATCHED'), files: [] },
              { ...episode(2, 'IN_PROGRESS', 30), files: [null] },
              episode(3),
            ],
          }),
        ],
      }),
    )
    renderAppAt('/series/series-1')

    expect(await screen.findByRole('link', { name: 'Continue S1 E3' })).toHaveAttribute(
      'href',
      '/play/file-e3?episode=s3',
    )
  })

  it('shouldKeepTheShowOnScreenWhileItIsReadAgain', async () => {
    serve(seriesData())
    const series = answersThenHolds(seriesData(), seriesData({ tagline: 'One more stop.' }))
    server.use(graphql.query('SeriesDetail', series.resolver))
    renderAppAt('/series/series-1')
    const title = await screen.findByRole('heading', { level: 1, name: 'Northern Line' })

    comeBackOnline()
    await waitFor(() => expect(series.calls).toBe(2))
    expect(title).toBeInTheDocument()
    series.release()

    expect(await screen.findByText('One more stop.')).toBeInTheDocument()
    expect(title).toBeInTheDocument()
  })

  it('shouldKeepTheShowWhenReadingItAgainFails', async () => {
    serve(seriesData())
    const fresh = heldAnswer(seriesData({ tagline: 'One more stop.' }))
    const series = answersInTurn(answerWith(seriesData()), serverFailure, fresh.answer)
    server.use(graphql.query('SeriesDetail', series.resolver))
    renderAppAt('/series/series-1')
    const title = await screen.findByRole('heading', { level: 1, name: 'Northern Line' })

    await comeBackOnlineUntil(series, 3)
    expect(title).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fresh.release()

    expect(await screen.findByText('One more stop.')).toBeInTheDocument()
    expect(title).toBeInTheDocument()
  })

  it('shouldRetryTheShowAfterItFailsToLoad', async () => {
    const series = failsOnceThen(seriesData())
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('SeriesDetail', series.resolver),
    )
    const { user } = renderAppAt('/series/series-1')

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this show.")

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Northern Line' }),
    ).toBeInTheDocument()
    expect(series.calls).toBe(2)
  })

  it('shouldShowNotFoundWithoutRetryWhenTheShowDoesNotExist', async () => {
    serve({ series: null })
    renderAppAt('/series/series-1')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This show doesn't exist or was removed.",
    )
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('shouldTreatAMalformedShowIdAsNotFound', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('SeriesDetail', () => invalidIdResponse('series')),
    )
    renderAppAt('/series/abc')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This show doesn't exist or was removed.",
    )
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('queries the series named in the URL and renders its header', async () => {
    const requestedIds: string[] = []
    serve(seriesData(), requestedIds)
    renderAppAt('/series/series-1')

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Northern Line' })).toBeInTheDocument(),
    )
    expect(requestedIds).toEqual(['series-1'])
    expect(screen.getByText('Their last resort.')).toBeInTheDocument()
    expect(screen.getByText('A crime drama.')).toBeInTheDocument()
    expect(screen.getByText('Crime, Drama')).toBeInTheDocument()
    expect(screen.getByText('Created by')).toBeInTheDocument()
    expect(screen.getByText('Placeholder Creator')).toBeInTheDocument()
    expect(screen.getByText('21 Jul 2017')).toBeInTheDocument()
    expect(screen.getByText('TV-MA')).toBeInTheDocument()
    expect(screen.getByTestId('ambient-scope').style.getPropertyValue('--ambient-accent')).toBe(
      '#6fe0bf',
    )
  })

  it('resumes the in-progress episode at its saved position', async () => {
    serve(seriesData())
    renderAppAt('/series/series-1')
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Resume S2 E5' })).toHaveAttribute(
        'href',
        '/play/file-s2e5?episode=season-2-s5&position=600',
      ),
    )
  })

  it('continues with the next unwatched episode when nothing is mid-watch', async () => {
    serve(seriesData({ seasons: [season(1, [episode(1, 'WATCHED'), episode(2)])] }))
    renderAppAt('/series/series-1')
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Continue S1 E2' })).toHaveAttribute(
        'href',
        '/play/file-s1e2?episode=season-1-s2',
      ),
    )
  })

  it('offers to play the first episode of an untouched series', async () => {
    serve(seriesData({ watchStatus: 'UNWATCHED', seasons: [season(1, [episode(1), episode(2)])] }))
    renderAppAt('/series/series-1')
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Play S1 E1' })).toHaveAttribute(
        'href',
        '/play/file-s1e1?episode=season-1-s1',
      ),
    )
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

  it('shouldConfirmAndThenUpdateEverySeasonAndEpisodeFromTheMarkedSeries', async () => {
    const markedIds: string[] = []
    const data = seriesData()
    serve(data)
    const watchedState = { watchStatus: 'WATCHED', watchProgress: null }
    const marked = {
      series: {
        ...data.series!,
        ...watchedState,
        seasons: data.series!.seasons.map((entry) => ({
          ...entry!,
          ...watchedState,
          episodes: entry!.episodes.map((episode) => ({ ...episode!, ...watchedState })),
        })),
      },
    } as SeriesDetailQuery
    const after = heldAnswer(marked)
    const series = answersInTurn(answerWith(data), after.answer)
    server.use(
      graphql.query('SeriesDetail', series.resolver),
      graphql.mutation('MarkWatched', ({ variables }) => {
        markedIds.push((variables.input as { itemId: string }).itemId)
        return HttpResponse.json({
          data: {
            markWatched: {
              item: {
                __typename: 'Series',
                id: 'series-1',
                ...watchedState,
                seasons: data.series!.seasons.map((entry) => ({
                  __typename: 'Season',
                  id: entry!.id,
                  ...watchedState,
                  episodes: entry!.episodes.map((episode) => ({
                    __typename: 'Episode',
                    id: episode!.id,
                    ...watchedState,
                  })),
                })),
              },
              userErrors: [],
            },
          },
        })
      }),
    )
    const { user } = renderAppAt('/series/series-1')

    await user.click(await screen.findByRole('button', { name: 'Mark series watched' }))
    expect(markedIds).toEqual([])
    expect(
      screen.getByRole('dialog', { name: 'Mark Northern Line as watched?' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mark watched' }))

    expect(await screen.findByRole('button', { name: 'Mark series unwatched' })).toBeEnabled()
    expect(screen.getByRole('progressbar', { name: '5 of 5 watched' })).toBeInTheDocument()
    expect(screen.getAllByLabelText('Watched')).toHaveLength(2)
    expect(screen.queryByLabelText('2 unwatched')).not.toBeInTheDocument()
    expect(markedIds).toEqual(['series-1'])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(series.calls).toBe(2))
    expect(screen.getByRole('progressbar', { name: '5 of 5 watched' })).toBeInTheDocument()
    after.release()
  })

  it('shouldShowTheServerMessageWhenMarkingTheSeriesIsRefused', async () => {
    server.use(
      graphql.mutation('MarkWatched', () =>
        HttpResponse.json({
          data: {
            markWatched: {
              item: null,
              userErrors: [{ __typename: 'InvalidIdError', message: 'The ID is not valid.' }],
            },
          },
        }),
      ),
    )
    const { user } = await renderSeries(seriesData())

    await user.click(screen.getByRole('button', { name: 'Mark series watched' }))
    await user.click(screen.getByRole('button', { name: 'Mark watched' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The ID is not valid.')
    expect(screen.getByRole('button', { name: 'Mark series watched' })).toBeEnabled()
  })

  it('confirms before marking the whole series unwatched, and cancelling changes nothing', async () => {
    const markedIds: string[] = []
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('SeriesDetail', () =>
        HttpResponse.json({ data: seriesData({ watchStatus: 'WATCHED' }) }),
      ),
      graphql.mutation('MarkUnwatched', ({ variables }) => {
        markedIds.push((variables.input as { itemId: string }).itemId)
        return HttpResponse.json({ data: { markUnwatched: { userErrors: [] } } })
      }),
    )
    const { user } = renderAppAt('/series/series-1')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Mark series unwatched' })).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: 'Mark series unwatched' }))
    expect(
      screen.getByRole('dialog', { name: 'Mark Northern Line as unwatched?' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(markedIds).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Mark series unwatched' }))
    await user.click(screen.getByRole('button', { name: 'Mark unwatched' }))
    await waitFor(() => expect(markedIds).toEqual(['series-1']))
  })

  it('shouldDisableTheBulkActionWhilePendingAndShowAFailureWithoutChangingItsVerb', async () => {
    const response = deferred()
    server.use(
      graphql.mutation('MarkWatched', async () => {
        await response.promise
        return HttpResponse.json({ errors: [{ message: 'Could not save watched state.' }] })
      }),
    )
    const { user } = await renderSeries(seriesData())
    await user.click(screen.getByRole('button', { name: 'Mark series watched' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'All 2 seasons — 5 episodes — will be marked watched.',
    )
    await user.click(screen.getByRole('button', { name: 'Mark watched' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark series watched' })).toBeDisabled()
    response.resolve()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Couldn't update the watched state\.$/,
    )
    expect(screen.getByRole('button', { name: 'Mark series watched' })).toBeEnabled()
  })

  it('links each season card to its page', async () => {
    await renderSeries(seriesData())
    expect(screen.getByRole('link', { name: /Season 1/ })).toHaveAttribute(
      'href',
      '/season/season-1',
    )
    expect(screen.getByRole('link', { name: /Season 2/ })).toHaveAttribute(
      'href',
      '/season/season-2',
    )
  })

  it('lists the cast in a shelf when present', async () => {
    await renderSeries(seriesData())
    expect(screen.getByRole('heading', { name: 'Cast' })).toBeInTheDocument()
    expect(screen.getByText('Lead Actor')).toBeInTheDocument()
  })
})
