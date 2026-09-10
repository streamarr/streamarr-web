import { describe, expect, it } from 'vitest'
import type { MediaSummaryFieldsFragment } from '../graphql/generated/graphql'
import { summarizeMedia, summaryLetter } from './summarizeMedia'

function movie(overrides: Partial<Extract<MediaSummaryFieldsFragment, { __typename: 'Movie' }>> = {}) {
  return {
    __typename: 'Movie',
    id: 'movie-1',
    title: 'Everlight',
    titleSort: 'Everlight',
    releaseDate: '2024-03-15',
    runtime: 142,
    watchStatus: 'UNWATCHED',
    watchProgress: null,
    images: [],
    ...overrides,
  } satisfies Extract<MediaSummaryFieldsFragment, { __typename: 'Movie' }>
}

function series(overrides: Partial<Extract<MediaSummaryFieldsFragment, { __typename: 'Series' }>> = {}) {
  return {
    __typename: 'Series',
    id: 'series-1',
    title: 'Northern Line',
    titleSort: 'Northern Line',
    firstAirDate: '2017-09-01',
    seasons: [{ id: 's1' }, { id: 's2' }],
    watchStatus: 'IN_PROGRESS',
    watchProgress: { percentComplete: 27 },
    images: [],
    ...overrides,
  } satisfies Extract<MediaSummaryFieldsFragment, { __typename: 'Series' }>
}

describe('summarizeMedia', () => {
  it('builds a "year · runtime" meta line for a movie', () => {
    expect(summarizeMedia(movie()).meta).toBe('2024 · 2h 22m')
  })

  it('builds a "year · N seasons" meta line for a series', () => {
    expect(summarizeMedia(series()).meta).toBe('2017 · 2 seasons')
  })

  it('uses singular "season" for a single-season series', () => {
    expect(summarizeMedia(series({ seasons: [{ id: 's1' }] })).meta).toBe('2017 · 1 season')
  })

  it('omits the missing half of the meta line when the date is unknown', () => {
    expect(summarizeMedia(movie({ releaseDate: null })).meta).toBe('2h 22m')
    expect(summarizeMedia(movie({ releaseDate: null, runtime: null })).meta).toBe('')
  })

  it('passes watch status and progress through unchanged', () => {
    const summary = summarizeMedia(series())
    expect(summary.watchStatus).toBe('IN_PROGRESS')
    expect(summary.percentComplete).toBe(27)
  })

  it('falls back to "Untitled" when the server has no title yet', () => {
    expect(summarizeMedia(movie({ title: null, titleSort: null })).title).toBe('Untitled')
  })
})

describe('summaryLetter', () => {
  it('buckets by the summary title', () => {
    expect(summaryLetter(summarizeMedia(series()))).toBe('N')
  })
})
