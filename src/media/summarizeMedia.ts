import type { MediaSummaryFieldsFragment, WatchStatus } from '../graphql/generated/graphql'
import { alphabetLetterFromTitle } from './alphabetLetter'
import { formatRuntime, formatYear } from './formatting'
import { pickImageVariant, type PickedImage } from './images'

export interface MediaSummary {
  id: string
  title: string
  titleSort: string
  meta: string
  poster: PickedImage | null
  blurHash: string | null
  watchStatus: WatchStatus
  percentComplete: number | null
}

export function summarizeMedia(media: MediaSummaryFieldsFragment): MediaSummary {
  const image = media.images[0] ?? null
  const title = media.title ?? 'Untitled'
  const titleSort = media.titleSort ?? title

  return {
    id: media.id,
    title,
    titleSort,
    meta: media.__typename === 'Movie' ? movieMeta(media) : seriesMeta(media),
    poster: pickImageVariant(image, 'MEDIUM'),
    blurHash: image?.blurHash ?? null,
    watchStatus: media.watchStatus,
    percentComplete: media.watchProgress?.percentComplete ?? null,
  }
}

function movieMeta(movie: Extract<MediaSummaryFieldsFragment, { __typename: 'Movie' }>): string {
  return joinMeta([formatYear(movie.releaseDate), movie.runtime != null ? formatRuntime(movie.runtime) : null])
}

function seriesMeta(series: Extract<MediaSummaryFieldsFragment, { __typename: 'Series' }>): string {
  const seasonCount = series.seasons.length
  return joinMeta([formatYear(series.firstAirDate), `${seasonCount} season${seasonCount === 1 ? '' : 's'}`])
}

function joinMeta(parts: (string | null)[]): string {
  return parts.filter((part): part is string => part !== null).join(' · ')
}

export function summaryLetter(summary: MediaSummary): string {
  return alphabetLetterFromTitle(summary.titleSort)
}
