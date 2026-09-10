import type { HomeQuery } from '../graphql/generated/graphql'
import { formatRelativeTime, formatRuntime } from '../media/formatting'
import { pickImageVariant, type PickedImage } from '../media/images'

export interface BillboardMetadataEntry {
  label: string
  value: string
}

export interface BillboardContent {
  title: string
  tagline: string | null
  synopsis: string | null
  backdrop: PickedImage | null
  blurHash: string | null
  metadata: BillboardMetadataEntry[]
  ctaLabel: string
  ctaFileId: string | null
  ctaPositionSeconds: number | null
}

type ContinueWatchingItem = HomeQuery['continueWatching'][number]
type ContinueWatchingMovie = Extract<ContinueWatchingItem, { __typename: 'Movie' }>
type ContinueWatchingEpisode = Extract<ContinueWatchingItem, { __typename: 'Episode' }>
type RecentlyAddedNode = NonNullable<
  NonNullable<HomeQuery['libraries'][number]['items']['edges']>[number]
>['node']
type RecentlyAddedMovie = Extract<RecentlyAddedNode, { __typename: 'Movie' }>
type RecentlyAddedSeries = Extract<RecentlyAddedNode, { __typename: 'Series' }>

export function billboardFromContinueWatching(media: ContinueWatchingItem): BillboardContent {
  return media.__typename === 'Movie' ? movieBillboard(media) : episodeBillboard(media)
}

export function billboardFromRecentlyAdded(media: RecentlyAddedMovie | RecentlyAddedSeries): BillboardContent {
  return media.__typename === 'Movie' ? recentMovieBillboard(media) : recentSeriesBillboard(media)
}

function movieBillboard(movie: ContinueWatchingMovie): BillboardContent {
  const backdrop = movie.images[0] ?? null
  const position = resumePosition(movie.watchProgress)
  return {
    title: movie.title ?? 'Untitled',
    tagline: movie.tagline,
    synopsis: movie.summary,
    backdrop: pickImageVariant(backdrop, 'LARGE'),
    blurHash: backdrop?.blurHash ?? null,
    metadata: [
      { label: 'Runtime', value: movie.runtime != null ? formatRuntime(movie.runtime) : '—' },
      { label: 'Genre', value: genreLabel(movie.genres) },
      { label: 'Added', value: formatRelativeTime(movie.createdOn) },
    ],
    ctaLabel: position ? 'Resume' : 'Play',
    ctaFileId: movie.files[0]?.id ?? null,
    ctaPositionSeconds: position,
  }
}

function episodeBillboard(episode: ContinueWatchingEpisode): BillboardContent {
  const series = episode.season.series
  const backdrop = series.images[0] ?? null
  const position = resumePosition(episode.watchProgress)
  return {
    title: series.title ?? 'Untitled',
    tagline: series.tagline,
    synopsis: episode.overview ?? series.summary,
    backdrop: pickImageVariant(backdrop, 'LARGE'),
    blurHash: backdrop?.blurHash ?? null,
    metadata: [
      { label: 'Seasons', value: String(series.seasons.length) },
      { label: 'Genre', value: genreLabel(series.genres) },
      { label: 'Added', value: formatRelativeTime(series.createdOn) },
    ],
    // Resume = mid-watch stream, Continue = next unwatched episode (principle 14).
    ctaLabel: `${position ? 'Resume' : 'Continue'} S${episode.season.seasonNumber} E${episode.episodeNumber}`,
    ctaFileId: episode.files[0]?.id ?? null,
    ctaPositionSeconds: position,
  }
}

function recentMovieBillboard(movie: RecentlyAddedMovie): BillboardContent {
  const backdrop = movie.backdropImages[0] ?? null
  return {
    title: movie.title ?? 'Untitled',
    tagline: movie.tagline,
    synopsis: movie.summary,
    backdrop: pickImageVariant(backdrop, 'LARGE'),
    blurHash: backdrop?.blurHash ?? null,
    metadata: [
      { label: 'Runtime', value: movie.runtime != null ? formatRuntime(movie.runtime) : '—' },
      { label: 'Genre', value: genreLabel(movie.genres) },
      { label: 'Added', value: formatRelativeTime(movie.createdOn) },
    ],
    ctaLabel: 'Play',
    ctaFileId: movie.files[0]?.id ?? null,
    ctaPositionSeconds: null,
  }
}

function recentSeriesBillboard(series: RecentlyAddedSeries): BillboardContent {
  const backdrop = series.backdropImages[0] ?? null
  return {
    title: series.title ?? 'Untitled',
    tagline: series.tagline,
    synopsis: series.summary,
    backdrop: pickImageVariant(backdrop, 'LARGE'),
    blurHash: backdrop?.blurHash ?? null,
    metadata: [
      { label: 'Seasons', value: String(series.seasons.length) },
      { label: 'Genre', value: genreLabel(series.genres) },
      { label: 'Added', value: formatRelativeTime(series.createdOn) },
    ],
    ctaLabel: 'Play',
    ctaFileId: null,
    ctaPositionSeconds: null,
  }
}

function resumePosition(progress: { positionSeconds: number } | null | undefined): number | null {
  return progress && progress.positionSeconds > 0 ? progress.positionSeconds : null
}

function genreLabel(genres: ReadonlyArray<{ name: string } | null>): string {
  const names = genres.filter((genre): genre is { name: string } => genre !== null).map((genre) => genre.name)
  return names.length > 0 ? names.join(', ') : '—'
}
