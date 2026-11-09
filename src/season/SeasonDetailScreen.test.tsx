import { act, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type {
  SeasonDetailQuery,
  SeriesDetailQuery,
  WatchStatus,
} from '../graphql/generated/graphql'
import { selectedProfileState } from '../test/selectedProfileStateFixture'
import { watchingConnection } from '../test/continueWatchingFixtures'
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
  networkFailure,
} from '../test/graphqlResponses'
import {
  languagePreferenceFixture,
  pickMenuRow,
  serveLanguageTabs,
  titleBecomes,
} from '../test/languageFixtures'
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

function siblingSeason(number: number, status: WatchStatus, episodeStatuses: WatchStatus[]) {
  return {
    __typename: 'Season',
    id: `season-${number}`,
    seasonNumber: number,
    title: `Season ${number}`,
    selectedProfileState: selectedProfileState({ watchStatus: status }),
    episodes: episodeStatuses.map((watchStatus, index) => ({
      __typename: 'Episode',
      id: `s${number}e${index + 1}`,
      selectedProfileState: selectedProfileState({ watchStatus }),
    })),
  }
}

function episode(
  number: number,
  title: string,
  overrides: {
    watchStatus?: WatchStatus
    positionSeconds?: number
    durationSeconds?: number
    percentComplete?: number
  } = {},
) {
  const inProgress = overrides.positionSeconds != null
  return {
    __typename: 'Episode',
    id: `e${number}`,
    title,
    episodeNumber: number,
    runtime: 52,
    selectedProfileState: selectedProfileState({
      watchStatus: overrides.watchStatus,
      watchProgress: inProgress
        ? {
            positionSeconds: overrides.positionSeconds,
            percentComplete: overrides.percentComplete ?? 29,
            durationSeconds: overrides.durationSeconds ?? 2040,
          }
        : null,
    }),
    files: [{ id: `file-e${number}` }],
    stillImages: [],
  }
}

function seasonData(overrides: Record<string, unknown> = {}): SeasonDetailQuery {
  return {
    season: {
      __typename: 'Season',
      id: 'season-2',
      title: 'Season 2',
      seasonNumber: 2,
      overview: 'The team regroups.',
      airDate: '2018-03-01',
      selectedProfileState: selectedProfileState({ watchStatus: 'IN_PROGRESS' }),
      series: {
        __typename: 'Series',
        id: 'series-1',
        title: 'Northern Line',
        contentRating: { value: 'TV-MA' },
        directors: [{ id: 'p1', name: 'Placeholder Creator' }],
        seasons: [
          siblingSeason(1, 'WATCHED', ['WATCHED', 'WATCHED']),
          siblingSeason(2, 'IN_PROGRESS', ['UNWATCHED', 'IN_PROGRESS', 'WATCHED']),
          siblingSeason(3, 'UNWATCHED', ['UNWATCHED', 'UNWATCHED', 'UNWATCHED']),
        ],
        backdropImages: [image({ ambientColors: COLORED })],
      },
      episodes: [
        episode(4, 'Cold Open'),
        episode(5, 'Breakage', { watchStatus: 'IN_PROGRESS', positionSeconds: 600 }),
        episode(6, 'Grievances', { watchStatus: 'WATCHED' }),
      ],
      backdropImages: [],
      posterImages: [],
      ...overrides,
    },
  } as SeasonDetailQuery
}

function serve(data: SeasonDetailQuery, requestedIds: string[] = []) {
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('SeasonDetail', ({ variables }) => {
      requestedIds.push(variables.id as string)
      return HttpResponse.json({ data })
    }),
  )
  serveLanguageTabs()
}

async function renderSeason(data: SeasonDetailQuery = seasonData()) {
  serve(data)
  const rendered = renderAppAt('/season/season-2')
  await waitFor(() =>
    expect(screen.getByRole('heading', { level: 1, name: 'Season 2' })).toBeInTheDocument(),
  )
  return rendered
}

describe('SeasonDetailScreen', () => {
  it('shouldSetThisTitlesOwnAudioOverrideFromItsDefaultAudioTab', async () => {
    serve(seasonData())
    const tabs = serveLanguageTabs({
      preference: languagePreferenceFixture({ audioLanguages: ['FR'] }),
      answer: titleBecomes(
        { __typename: 'Season', id: 'season-2' },
        languagePreferenceFixture({ audioLanguages: ['JA', 'FR'], audioSource: 'SEASON' }),
      ),
    })
    const { user } = renderAppAt('/season/season-2')
    await screen.findByRole('heading', { level: 1, name: 'Season 2' })

    const audio = await screen.findByRole('button', { name: 'Default audio' })
    expect(audio).toHaveAccessibleDescription('French · from Profile')
    await user.click(audio)
    await pickMenuRow(user, 'Japanese')

    await waitFor(() => expect(tabs.inputs).toEqual([{ itemId: 'season-2', audioLanguage: 'JA' }]))
    await waitFor(() => expect(audio).toHaveAccessibleDescription('Japanese · set here'))
  })

  it('shouldKeepCountsAndBulkActionsInStepWithEpisodesReturnedByTheServer', async () => {
    const before = seasonData({
      episodes: [episode(1, 'Pilot', { watchStatus: 'WATCHED' }), episode(3, 'Return')],
    })
    const after = seasonData({
      selectedProfileState: selectedProfileState({ watchStatus: 'WATCHED' }),
      episodes: [episode(1, 'Pilot', { watchStatus: 'WATCHED' })],
      series: {
        ...before.season!.series,
        seasons: [siblingSeason(2, 'WATCHED', ['WATCHED'])],
      },
    })
    serve(before)
    server.use(
      graphql.query('SeasonDetail', answersInTurn(answerWith(before), answerWith(after)).resolver),
    )
    const { user } = renderAppAt('/season/season-2')

    expect(await screen.findByRole('progressbar', { name: '1 of 2 watched' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /E3 — Return/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark season watched' }))
    expect(screen.getByText('All 2 episodes will be marked watched.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    comeBackOnline()

    expect(await screen.findByRole('progressbar', { name: '1 of 1 watched' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /E3 — Return/ })).not.toBeInTheDocument()
    expect(screen.getByText('Seasons · 1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark season unwatched' }))
    expect(screen.getByText('All 1 episodes will be marked unwatched.')).toBeInTheDocument()
  })

  it('shouldNotLabelAnEmptyUnwatchedSeasonAsWatched', async () => {
    const data = seasonData()
    data.season!.series.seasons.push(siblingSeason(4, 'UNWATCHED', []))
    await renderSeason(data)
    const emptySeason = screen.getByRole('button', { name: /Season 4/ })
    expect(within(emptySeason).queryByLabelText('Watched')).not.toBeInTheDocument()
  })

  it('shouldPlayAnEpisodeWhenItsFirstFileIsNull', async () => {
    await renderSeason(
      seasonData({
        episodes: [{ ...episode(4, 'Cold Open'), files: [null, { id: 'file-e4' }] }],
      }),
    )
    expect(screen.getByRole('link', { name: /Cold Open/ })).toHaveAttribute(
      'href',
      '/play/file-e4?episode=e4',
    )
  })

  it('shouldKeepTheSeasonOnScreenWhileItIsReadAgain', async () => {
    serve(seasonData())
    const season = answersThenHolds(seasonData(), seasonData({ overview: 'The team splits up.' }))
    server.use(graphql.query('SeasonDetail', season.resolver))
    renderAppAt('/season/season-2')
    const title = await screen.findByRole('heading', { level: 1, name: 'Season 2' })

    comeBackOnline()
    await waitFor(() => expect(season.calls).toBe(2))
    expect(title).toBeInTheDocument()
    season.release()

    expect(await screen.findByText('The team splits up.')).toBeInTheDocument()
    expect(title).toBeInTheDocument()
  })

  it('shouldKeepTheSeasonWhenReadingItAgainFails', async () => {
    serve(seasonData())
    const fresh = heldAnswer(seasonData({ overview: 'The team splits up.' }))
    const season = answersInTurn(answerWith(seasonData()), networkFailure, fresh.answer)
    server.use(graphql.query('SeasonDetail', season.resolver))
    renderAppAt('/season/season-2')
    const title = await screen.findByRole('heading', { level: 1, name: 'Season 2' })

    await comeBackOnlineUntil(season, 3)
    expect(title).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fresh.release()

    expect(await screen.findByText('The team splits up.')).toBeInTheDocument()
    expect(title).toBeInTheDocument()
  })

  it('shouldRetryTheSeasonAfterItFailsToLoad', async () => {
    const season = failsOnceThen(seasonData())
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('SeasonDetail', season.resolver),
    )
    const { user } = renderAppAt('/season/season-2')

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this season.")

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Season 2' })).toBeInTheDocument()
    expect(season.calls).toBe(2)
  })

  it('shouldShowNotFoundWithoutRetryWhenTheSeasonDoesNotExist', async () => {
    serve({ season: null })
    renderAppAt('/season/season-2')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This season doesn't exist or was removed.",
    )
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('shouldTreatAMalformedSeasonIdAsNotFound', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('SeasonDetail', () => invalidIdResponse('season')),
    )
    renderAppAt('/season/abc')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This season doesn't exist or was removed.",
    )
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('queries the season named in the URL and renders its header under the series', async () => {
    const requestedIds: string[] = []
    serve(seasonData(), requestedIds)
    renderAppAt('/season/season-2')

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Season 2' })).toBeInTheDocument(),
    )
    expect(requestedIds).toEqual(['season-2'])
    expect(screen.getByRole('link', { name: 'Northern Line' })).toHaveAttribute(
      'href',
      '/series/series-1',
    )
    expect(screen.getByText('The team regroups.')).toBeInTheDocument()
    expect(screen.getByText('Created by')).toBeInTheDocument()
    expect(screen.getByText('Placeholder Creator')).toBeInTheDocument()
    expect(screen.getByText('First aired')).toBeInTheDocument()
    expect(screen.getByText('2018')).toBeInTheDocument()
    expect(screen.getAllByRole('term').map((term) => term.textContent)).toContain('Episodes')
    expect(screen.getAllByRole('definition').map((definition) => definition.textContent)).toContain(
      '3',
    )
    expect(screen.getByText('TV-MA')).toBeInTheDocument()
  })

  it('inherits the series backdrop tint when the season has no backdrop of its own', async () => {
    await renderSeason()
    expect(screen.getByTestId('ambient-scope').style.getPropertyValue('--ambient-accent')).toBe(
      '#6fe0bf',
    )
  })

  it('resumes the in-progress episode without repeating the season in the verb', async () => {
    await renderSeason()
    expect(screen.getByRole('link', { name: 'Resume E5' })).toHaveAttribute(
      'href',
      '/play/file-e5?episode=e5&position=600',
    )
  })

  it('shouldContinueWithAnEpisodeThatHasNoSelectedProfileState', async () => {
    await renderSeason(
      seasonData({
        episodes: [
          episode(4, 'Cold Open', { watchStatus: 'WATCHED' }),
          { ...episode(5, 'Breakage'), selectedProfileState: null },
        ],
      }),
    )
    expect(screen.getByRole('link', { name: 'Continue E5' })).toHaveAttribute(
      'href',
      '/play/file-e5?episode=e5',
    )
    const card = screen.getByRole('link', { name: /E5 — Breakage/ })
    expect(within(card).queryByLabelText('Watched')).not.toBeInTheDocument()
    expect(within(card).getByText('52m')).toBeInTheDocument()
  })

  it('rolls the watched episodes up into the progress divider', async () => {
    await renderSeason()
    expect(screen.getByRole('progressbar', { name: '1 of 3 watched' })).toBeInTheDocument()
  })

  it('lists the sibling seasons in the rail with this one current, and navigates on selection', async () => {
    const { user, router } = await renderSeason()
    expect(screen.getByText('Seasons · 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Season 2/ })).toHaveAttribute('aria-current', 'true')

    await user.click(screen.getByRole('button', { name: /Season 3/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/season/season-3'))
  })

  it('renders each episode as a still that plays directly, with its state in the subtitle', async () => {
    await renderSeason()
    expect(screen.getByRole('link', { name: /E4 — Cold Open/ })).toHaveAttribute(
      'href',
      '/play/file-e4?episode=e4',
    )
    expect(screen.getByRole('link', { name: /E5 — Breakage/ })).toHaveAttribute(
      'href',
      '/play/file-e5?episode=e5&position=600',
    )
    expect(screen.getByText('24m left')).toBeInTheDocument()
    const watchedEpisode = screen.getByRole('link', { name: /E6 — Grievances/ })
    expect(within(watchedEpisode).getByLabelText('Watched')).toBeInTheDocument()
    expect(screen.getAllByText('52m')).toHaveLength(2)
  })

  it('shouldGiveAnEpisodeInProgressOneProgressReadout', async () => {
    await renderSeason()
    const episode = screen.getByRole('link', { name: /E5 — Breakage/ })
    expect(within(episode).getAllByText('24m left')).toHaveLength(1)
    expect(episode.querySelector('[style*="width"]')).toBeNull()
  })

  it('shouldConfirmAndThenUpdateEveryEpisodeFromTheMarkedSeason', async () => {
    const markedIds: string[] = []
    const data = seasonData()
    serve(data)
    const watchedState = { selectedProfileState: selectedProfileState({ watchStatus: 'WATCHED' }) }
    const marked = {
      season: {
        ...data.season!,
        ...watchedState,
        episodes: data.season!.episodes.map((episode) => ({ ...episode!, ...watchedState })),
      },
    } as SeasonDetailQuery
    const after = heldAnswer(marked)
    const season = answersInTurn(answerWith(data), after.answer)
    server.use(
      graphql.query('SeasonDetail', season.resolver),
      graphql.mutation('MarkWatched', ({ variables }) => {
        markedIds.push((variables.input as { itemId: string }).itemId)
        return HttpResponse.json({
          data: {
            markWatched: {
              item: {
                __typename: 'Season',
                id: 'season-2',
                ...watchedState,
                episodes: ['e4', 'e5', 'e6'].map((id) => ({
                  __typename: 'Episode',
                  id,
                  ...watchedState,
                })),
                series: {
                  __typename: 'Series',
                  id: 'series-1',
                  selectedProfileState: selectedProfileState({
                    watchStatus: 'IN_PROGRESS',
                    watchProgress: { positionSeconds: 0, percentComplete: 75, durationSeconds: 0 },
                  }),
                },
              },
              userErrors: [],
            },
          },
        })
      }),
    )
    const { user } = renderAppAt('/season/season-2')

    await user.click(await screen.findByRole('button', { name: 'Mark season watched' }))
    expect(screen.getByRole('dialog', { name: 'Mark Season 2 as watched?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark watched' }))

    expect(await screen.findByRole('button', { name: 'Mark season unwatched' })).toBeEnabled()
    expect(screen.getByRole('progressbar', { name: '3 of 3 watched' })).toBeInTheDocument()
    expect(markedIds).toEqual(['season-2'])
    await waitFor(() => expect(season.calls).toBe(2))
    expect(screen.getByRole('progressbar', { name: '3 of 3 watched' })).toBeInTheDocument()
    after.release()
  })

  it('shouldLeaveTheShowWithBackAfterReturningToItFromASeason', async () => {
    const { user, router } = await openSeasonFromShow()

    await returnToShowThenGoBack(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('shouldLeaveTheShowWithBackAfterSwitchingSeasonsAndReturningToTheShow', async () => {
    const { user, router } = await openSeasonFromShow()
    await user.click(screen.getByRole('button', { name: /Season 3/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/season/season-3'))

    await returnToShowThenGoBack(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('shouldLeaveAModifiedClickOnTheShowLinkToTheBrowser', async () => {
    const { user, router } = await openSeasonFromShow()

    await user.keyboard('{Meta>}')
    await user.click(screen.getByRole('link', { name: 'Northern Line' }))
    await user.keyboard('{/Meta}')

    expect(router.state.location.pathname).toBe('/season/season-2')
  })

  it('shouldLeaveTheShowWithBackAfterOpeningItFromALinkedSeason', async () => {
    serveShowAndSeason()
    const { user, router } = renderAppAt('/season/season-2')
    await screen.findByRole('heading', { level: 1, name: 'Season 2' })

    await returnToShowThenGoBack(user)

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})

const showSeason = {
  __typename: 'Season',
  id: 'season-2',
  seasonNumber: 2,
  title: 'Season 2',
  airDate: null,
  selectedProfileState: selectedProfileState({ watchStatus: 'IN_PROGRESS' }),
  posterImages: [],
  episodes: [],
}

function showData(): SeriesDetailQuery {
  return {
    series: {
      __typename: 'Series',
      id: 'series-1',
      title: 'Northern Line',
      tagline: null,
      summary: null,
      firstAirDate: null,
      selectedProfileState: selectedProfileState({ watchStatus: 'IN_PROGRESS' }),
      contentRating: null,
      genres: [],
      directors: [],
      cast: [],
      seasons: [showSeason],
      backdropImages: [],
      posterImages: [],
    },
  } as SeriesDetailQuery
}

function serveShowAndSeason() {
  serve(seasonData())
  server.use(
    graphql.query('Home', () =>
      HttpResponse.json({ data: { continueWatching: watchingConnection([]), libraries: [] } }),
    ),
    graphql.query('SeriesDetail', () => HttpResponse.json({ data: showData() })),
  )
}

async function openSeasonFromShow() {
  serveShowAndSeason()
  const rendered = renderAppAt('/')
  await act(() =>
    rendered.router.navigate({ to: '/series/$seriesId', params: { seriesId: 'series-1' } }),
  )
  await screen.findByRole('heading', { level: 1, name: 'Northern Line' })
  await rendered.user.click(screen.getByRole('link', { name: /^Season 2/ }))
  await screen.findByRole('heading', { level: 1, name: 'Season 2' })
  return rendered
}

async function returnToShowThenGoBack(user: UserEvent) {
  await user.click(screen.getByRole('link', { name: 'Northern Line' }))
  await screen.findByRole('heading', { level: 1, name: 'Northern Line' })
  await user.click(screen.getByRole('button', { name: 'Back' }))
}
