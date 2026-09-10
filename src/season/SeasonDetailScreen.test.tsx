import { screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { SeasonDetailQuery } from '../graphql/generated/graphql'
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

function siblingSeason(number: number, status: Status, episodeStatuses: Status[]) {
  return {
    id: `season-${number}`,
    seasonNumber: number,
    title: `Season ${number}`,
    watchStatus: status,
    episodes: episodeStatuses.map((watchStatus, index) => ({ id: `s${number}e${index + 1}`, watchStatus })),
  }
}

function episode(
  number: number,
  title: string,
  overrides: { watchStatus?: Status; positionSeconds?: number; durationSeconds?: number; percentComplete?: number } = {},
) {
  const inProgress = overrides.positionSeconds != null
  return {
    id: `e${number}`,
    title,
    episodeNumber: number,
    runtime: 52,
    watchStatus: overrides.watchStatus ?? 'UNWATCHED',
    watchProgress: inProgress
      ? {
          positionSeconds: overrides.positionSeconds,
          percentComplete: overrides.percentComplete ?? 29,
          durationSeconds: overrides.durationSeconds ?? 2040,
        }
      : null,
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
      watchStatus: 'IN_PROGRESS',
      series: {
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
}

async function renderSeason(data: SeasonDetailQuery = seasonData()) {
  serve(data)
  const rendered = renderAppAt('/season/season-2')
  await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Season 2' })).toBeInTheDocument())
  return rendered
}

describe('SeasonDetailScreen', () => {
  it('shows an error state when the query fails', async () => {
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('SeasonDetail', () => HttpResponse.json({ errors: [{ message: 'boom' }] })),
    )
    renderAppAt('/season/season-2')
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })

  it('queries the season named in the URL and renders its header under the series', async () => {
    const requestedIds: string[] = []
    serve(seasonData(), requestedIds)
    renderAppAt('/season/season-2')

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Season 2' })).toBeInTheDocument())
    expect(requestedIds).toEqual(['season-2'])
    expect(screen.getByRole('link', { name: 'Northern Line' })).toHaveAttribute('href', '/series/series-1')
    expect(screen.getByText('The team regroups.')).toBeInTheDocument()
    expect(screen.getByText('Created by')).toBeInTheDocument()
    expect(screen.getByText('Placeholder Creator')).toBeInTheDocument()
    expect(screen.getByText('First aired')).toBeInTheDocument()
    expect(screen.getByText('2018')).toBeInTheDocument()
    expect(screen.getAllByRole('term').map((term) => term.textContent)).toContain('Episodes')
    expect(screen.getAllByRole('definition').map((definition) => definition.textContent)).toContain('3')
    expect(screen.getByText('TV-MA')).toBeInTheDocument()
  })

  it('inherits the series backdrop tint when the season has no backdrop of its own', async () => {
    await renderSeason()
    expect(screen.getByTestId('ambient-scope').style.getPropertyValue('--ambient-accent')).toBe('#6fe0bf')
  })

  it('resumes the in-progress episode without repeating the season in the verb', async () => {
    await renderSeason()
    expect(screen.getByRole('link', { name: 'Resume E5' })).toHaveAttribute('href', '/play/file-e5?position=600')
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
    expect(screen.getByRole('link', { name: /E4 — Cold Open/ })).toHaveAttribute('href', '/play/file-e4')
    expect(screen.getByRole('link', { name: /E5 — Breakage/ })).toHaveAttribute('href', '/play/file-e5?position=600')
    expect(screen.getByText('24m left')).toBeInTheDocument()
    const watchedEpisode = screen.getByRole('link', { name: /E6 — Grievances/ })
    expect(within(watchedEpisode).getByLabelText('Watched')).toBeInTheDocument()
    expect(screen.getAllByText('52m')).toHaveLength(2)
  })

  it('confirms before marking the season watched, then flips the verb', async () => {
    let watched = false
    const markedIds: string[] = []
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('SeasonDetail', () =>
        HttpResponse.json({ data: seasonData({ watchStatus: watched ? 'WATCHED' : 'IN_PROGRESS' }) }),
      ),
      graphql.mutation('MarkWatched', ({ variables }) => {
        markedIds.push(variables.id as string)
        watched = true
        return HttpResponse.json({ data: { markWatched: true } })
      }),
    )
    const { user } = renderAppAt('/season/season-2')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark season watched' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Mark season watched' }))
    expect(screen.getByRole('dialog', { name: 'Mark Season 2 as watched?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark watched' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark season unwatched' })).toBeInTheDocument())
    expect(markedIds).toEqual(['season-2'])
  })
})
