import { describe, expect, it } from 'vitest'
import type { HomeQuery } from '../graphql/generated/graphql'
import { selectedProfileState } from '../test/selectedProfileStateFixture'
import { billboardFromContinueWatching, billboardFromRecentlyAdded } from './billboardContent'

type ContinueWatchingItem = NonNullable<
  NonNullable<HomeQuery['continueWatching']['edges'][number]>['node']
>
const TEAL = {
  base: '#071f1b',
  panel: '#0e3b34',
  selected: '#123f38',
  accent: '#6fe0bf',
  onAccent: '#06231c',
  textPrimary: '#ffffff',
  textSecondary: '#b9d6cf',
}

function coloredBackdrop(url: string) {
  return {
    aspectRatio: 1.78,
    blurHash: null,
    ambientColors: {
      topLeft: '#071f1b',
      topRight: '#071f1b',
      bottomRight: '#071f1b',
      bottomLeft: '#071f1b',
      primary: '#0d322c',
      theme: TEAL,
    },
    variants: [{ id: url, size: 'LARGE' as const, width: 1920, height: 1080, url }],
  }
}

type RecentlyAddedNode = NonNullable<
  NonNullable<HomeQuery['libraries'][number]['items']['edges']>[number]
>['node']

function continueWatchingMovie(
  overrides: Record<string, unknown> = {},
): Extract<ContinueWatchingItem, { __typename: 'Movie' }> {
  return {
    __typename: 'Movie',
    id: 'movie-1',
    title: 'Everlight',
    tagline: 'Change begins with a whisper.',
    summary: 'A quiet town discovers a secret.',
    runtime: 142,
    createdOn: '2026-08-26T12:00:00Z',
    genres: [{ id: 'g1', name: 'Drama' }],
    images: [
      {
        aspectRatio: 1.78,
        blurHash: 'HASH',
        ambientColors: null,
        variants: [
          { id: 'v1', size: 'LARGE', width: 1920, height: 1080, url: 'movie-backdrop.jpg' },
        ],
      },
    ],
    selectedProfileState: selectedProfileState(),
    files: [{ id: 'file-1' }],
    ...overrides,
  }
}

function continueWatchingEpisode(
  overrides: Record<string, unknown> = {},
): Extract<ContinueWatchingItem, { __typename: 'Episode' }> {
  return {
    __typename: 'Episode',
    id: 'episode-1',
    title: 'Breakage',
    episodeNumber: 5,
    overview: 'The team regroups.',
    runtime: 47,
    images: [],
    selectedProfileState: selectedProfileState({
      watchStatus: 'IN_PROGRESS',
      watchProgress: { positionSeconds: 600, percentComplete: 40, durationSeconds: 1500 },
    }),
    files: [{ id: 'file-2' }],
    season: {
      id: 'season-1',
      seasonNumber: 2,
      series: {
        id: 'series-1',
        title: 'Northern Line',
        tagline: 'Their last resort.',
        summary: 'A crime drama.',
        createdOn: '2026-08-27T09:00:00Z',
        genres: [{ id: 'g2', name: 'Crime' }],
        seasons: [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }],
        images: [
          {
            aspectRatio: 1.78,
            blurHash: 'SERIESHASH',
            ambientColors: null,
            variants: [
              { id: 'v2', size: 'LARGE', width: 1920, height: 1080, url: 'series-backdrop.jpg' },
            ],
          },
        ],
      },
    },
    ...overrides,
  }
}

function recentMovie(
  overrides: Record<string, unknown> = {},
): Extract<RecentlyAddedNode, { __typename: 'Movie' }> {
  return {
    __typename: 'Movie',
    id: 'movie-2',
    title: 'Everlight',
    titleSort: 'Everlight',
    releaseDate: '2024-01-01',
    runtime: 90,
    selectedProfileState: selectedProfileState(),
    images: [],
    tagline: 'Change begins with a whisper.',
    summary: 'A quiet town discovers a secret.',
    createdOn: '2026-08-28T00:00:00Z',
    genres: [{ id: 'g1', name: 'Drama' }],
    files: [{ id: 'file-3' }],
    backdropImages: [
      {
        aspectRatio: 1.78,
        blurHash: 'HASH2',
        ambientColors: null,
        variants: [
          { id: 'v3', size: 'LARGE', width: 1920, height: 1080, url: 'recent-backdrop.jpg' },
        ],
      },
    ],
    ...overrides,
  }
}

describe('billboardFromContinueWatching', () => {
  it('maps a Movie: Runtime/Genre/Added metadata, "Play" when never started', () => {
    const content = billboardFromContinueWatching(continueWatchingMovie())
    expect(content.title).toBe('Everlight')
    expect(content.metadata).toEqual([
      { label: 'Runtime', value: '2h 22m' },
      { label: 'Genre', value: 'Drama' },
      { label: 'Added', value: expect.stringContaining('ago') as string },
    ])
    expect(content.ctaLabel).toBe('Play')
    expect(content.ctaFileId).toBe('file-1')
    expect(content.ctaPositionSeconds).toBeNull()
  })

  it('maps a Movie in progress to a "Resume" CTA at its saved position', () => {
    const content = billboardFromContinueWatching(
      continueWatchingMovie({
        selectedProfileState: selectedProfileState({
          watchStatus: 'IN_PROGRESS',
          watchProgress: { positionSeconds: 10, percentComplete: 5, durationSeconds: 100 },
        }),
      }),
    )
    expect(content.ctaLabel).toBe('Resume')
    expect(content.ctaPositionSeconds).toBe(10)
  })

  it('shouldContinueFromTheStartWhenAnEpisodeHasNoSelectedProfileState', () => {
    const content = billboardFromContinueWatching(
      continueWatchingEpisode({ selectedProfileState: null }),
    )
    expect(content.ctaLabel).toBe('Continue S2 E5')
    expect(content.ctaPositionSeconds).toBeNull()
  })

  it('maps an Episode: Seasons/Genre/Added sourced from the parent series, "Resume S{n} E{n}"', () => {
    const content = billboardFromContinueWatching(continueWatchingEpisode())
    expect(content.title).toBe('Northern Line')
    expect(content.metadata).toEqual([
      { label: 'Seasons', value: '4' },
      { label: 'Genre', value: 'Crime' },
      { label: 'Added', value: expect.stringContaining('ago') as string },
    ])
    expect(content.ctaLabel).toBe('Resume S2 E5')
    expect(content.ctaFileId).toBe('file-2')
    expect(content.ctaPositionSeconds).toBe(600)
  })

  it("falls the episode's synopsis back to the series summary when the episode has none", () => {
    const content = billboardFromContinueWatching(continueWatchingEpisode({ overview: null }))
    expect(content.synopsis).toBe('A crime drama.')
  })

  it("carries the movie's ambient theme so the billboard action can take its accent", () => {
    const content = billboardFromContinueWatching(
      continueWatchingMovie({ images: [coloredBackdrop('movie-backdrop.jpg')] }),
    )
    expect(content.ambientTheme).toEqual(TEAL)
  })

  it("carries the series' ambient theme for an episode", () => {
    const episode = continueWatchingEpisode()
    const content = billboardFromContinueWatching({
      ...episode,
      season: {
        ...episode.season,
        series: { ...episode.season.series, images: [coloredBackdrop('series-backdrop.jpg')] },
      },
    })
    expect(content.ambientTheme).toEqual(TEAL)
  })

  it('carries no ambient theme when the backdrop has no ambient colors', () => {
    expect(billboardFromContinueWatching(continueWatchingMovie()).ambientTheme).toBeNull()
  })

  it('keeps the episode overview when present', () => {
    const content = billboardFromContinueWatching(continueWatchingEpisode())
    expect(content.synopsis).toBe('The team regroups.')
  })
})

describe('billboardFromRecentlyAdded', () => {
  it('maps a recently-added Movie with a "Play" CTA sourced from its file', () => {
    const content = billboardFromRecentlyAdded(recentMovie())
    expect(content.ctaLabel).toBe('Play')
    expect(content.ctaFileId).toBe('file-3')
    expect(content.ctaPositionSeconds).toBeNull()
  })

  it("carries the recently-added title's ambient theme", () => {
    const content = billboardFromRecentlyAdded(
      recentMovie({ backdropImages: [coloredBackdrop('recent-backdrop.jpg')] }),
    )
    expect(content.ambientTheme).toEqual(TEAL)
  })
})
