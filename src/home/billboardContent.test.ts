import { describe, expect, it } from 'vitest'
import type { HomeQuery } from '../graphql/generated/graphql'
import { billboardFromContinueWatching, billboardFromRecentlyAdded } from './billboardContent'

type ContinueWatchingItem = HomeQuery['continueWatching'][number]
type RecentlyAddedNode = NonNullable<
  NonNullable<HomeQuery['libraries'][number]['items']['edges']>[number]
>['node']

function continueWatchingMovie(overrides: Record<string, unknown> = {}): Extract<ContinueWatchingItem, { __typename: 'Movie' }> {
  return {
    __typename: 'Movie',
    id: 'movie-1',
    title: 'Everlight',
    tagline: 'Change begins with a whisper.',
    summary: 'A quiet town discovers a secret.',
    runtime: 142,
    createdOn: '2026-08-26T12:00:00Z',
    genres: [{ id: 'g1', name: 'Drama' }],
    images: [{ aspectRatio: 1.78, blurHash: 'HASH', variants: [{ id: 'v1', size: 'LARGE', width: 1920, height: 1080, url: 'movie-backdrop.jpg' }] }],
    watchProgress: null,
    files: [{ id: 'file-1' }],
    ...overrides,
  } as Extract<ContinueWatchingItem, { __typename: 'Movie' }>
}

function continueWatchingEpisode(overrides: Record<string, unknown> = {}): Extract<ContinueWatchingItem, { __typename: 'Episode' }> {
  return {
    __typename: 'Episode',
    id: 'episode-1',
    title: 'Breakage',
    episodeNumber: 5,
    overview: 'The team regroups.',
    runtime: 47,
    images: [],
    watchProgress: { positionSeconds: 600, percentComplete: 40, durationSeconds: 1500 },
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
        images: [{ aspectRatio: 1.78, blurHash: 'SERIESHASH', variants: [{ id: 'v2', size: 'LARGE', width: 1920, height: 1080, url: 'series-backdrop.jpg' }] }],
      },
    },
    ...overrides,
  } as Extract<ContinueWatchingItem, { __typename: 'Episode' }>
}

function recentMovie(overrides: Record<string, unknown> = {}): Extract<RecentlyAddedNode, { __typename: 'Movie' }> {
  return {
    __typename: 'Movie',
    id: 'movie-2',
    title: 'Everlight',
    titleSort: 'Everlight',
    releaseDate: '2024-01-01',
    runtime: 90,
    watchStatus: 'UNWATCHED',
    watchProgress: null,
    images: [],
    tagline: 'Change begins with a whisper.',
    summary: 'A quiet town discovers a secret.',
    createdOn: '2026-08-28T00:00:00Z',
    genres: [{ id: 'g1', name: 'Drama' }],
    files: [{ id: 'file-3' }],
    backdropImages: [{ aspectRatio: 1.78, blurHash: 'HASH2', variants: [{ id: 'v3', size: 'LARGE', width: 1920, height: 1080, url: 'recent-backdrop.jpg' }] }],
    ...overrides,
  } as Extract<RecentlyAddedNode, { __typename: 'Movie' }>
}

describe('billboardFromContinueWatching', () => {
  it('maps a Movie: Runtime/Genre/Added metadata, "Play" when never started', () => {
    const content = billboardFromContinueWatching(continueWatchingMovie())
    expect(content.title).toBe('Everlight')
    expect(content.metadata).toEqual([
      { label: 'Runtime', value: '2h 22m' },
      { label: 'Genre', value: 'Drama' },
      { label: 'Added', value: expect.stringContaining('ago') },
    ])
    expect(content.ctaLabel).toBe('Play')
    expect(content.ctaFileId).toBe('file-1')
  })

  it('maps a Movie in progress to a "Continue" CTA', () => {
    const content = billboardFromContinueWatching(
      continueWatchingMovie({ watchProgress: { positionSeconds: 10, percentComplete: 5, durationSeconds: 100 } }),
    )
    expect(content.ctaLabel).toBe('Continue')
  })

  it('maps an Episode: Seasons/Genre/Added sourced from the parent series, "Continue S{n} E{n}"', () => {
    const content = billboardFromContinueWatching(continueWatchingEpisode())
    expect(content.title).toBe('Northern Line')
    expect(content.metadata).toEqual([
      { label: 'Seasons', value: '4' },
      { label: 'Genre', value: 'Crime' },
      { label: 'Added', value: expect.stringContaining('ago') },
    ])
    expect(content.ctaLabel).toBe('Continue S2 E5')
    expect(content.ctaFileId).toBe('file-2')
  })

  it("falls the episode's synopsis back to the series summary when the episode has none", () => {
    const content = billboardFromContinueWatching(continueWatchingEpisode({ overview: null }))
    expect(content.synopsis).toBe('A crime drama.')
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
  })
})
