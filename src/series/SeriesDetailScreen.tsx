import { useQuery } from '@apollo/client/react'
import { Alert, Center, Loader } from '@mantine/core'
import { Link } from '@tanstack/react-router'
import { SeriesDetailDocument, type SeriesDetailQuery } from '../graphql/generated/graphql'
import { usePublishAmbientTheme } from '../media/ambientThemeContext'
import { resolveAmbientColors } from '../media/ambientSource'
import { CastCard } from '../media/CastCard'
import { ContentShelf } from '../media/ContentShelf'
import { DetailBackButton } from '../media/DetailBack'
import { detailAction, DetailHeader } from '../media/DetailHeader'
import { formatEpisodeLabel, formatLongDate, formatYear } from '../media/formatting'
import { PlayGlyph } from '../media/glyphs'
import { pickImageVariant } from '../media/images'
import { nextPlayableEpisode } from '../media/nextPlayableEpisode'
import { PosterCard } from '../media/PosterCard'
import { ProgressDivider } from '../media/ProgressDivider'
import { useBulkWatchedAction } from '../media/useBulkWatchedAction'
import type { WatchedBadgeProps } from '../media/WatchedBadge'
import styles from './SeriesDetailScreen.module.css'

type Series = NonNullable<SeriesDetailQuery['series']>
type Season = NonNullable<Series['seasons'][number]>
type Episode = NonNullable<Season['episodes'][number]>

export function SeriesDetailScreen({ seriesId }: Readonly<{ seriesId: string }>) {
  const { data, loading, error } = useQuery(SeriesDetailDocument, { variables: { id: seriesId } })
  const bulkWatched = useBulkWatchedAction({ kind: 'series', id: seriesId, detail: data?.series })
  const series = data?.series
  const ambient = series ? resolveAmbientColors(series.backdropImages, series.posterImages) : null
  usePublishAmbientTheme(ambient?.theme ?? null)

  if (loading) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    )
  }

  if (error || !series) {
    return (
      <Alert color="red" role="alert">
        Couldn't load this series. Try again.
      </Alert>
    )
  }

  const title = series.title ?? 'Untitled'
  const seasons = series.seasons.filter((season): season is Season => season !== null)
  const episodes = seasons.flatMap((season) =>
    season.episodes.filter((episode): episode is Episode => episode !== null),
  )
  const watchedCount = episodes.filter((episode) => episode.watchStatus === 'WATCHED').length
  const playable = nextPlayableEpisode(seasons)
  const artwork = series.backdropImages[0] ?? series.posterImages[0] ?? null
  const cast = series.cast.filter(
    (person): person is NonNullable<Series['cast'][number]> => person !== null,
  )

  return (
    <>
      <DetailHeader
        titleColumn
        backdrop={{
          image: pickImageVariant(artwork, 'LARGE'),
          blurHash: artwork?.blurHash ?? null,
          corners: ambient,
          height: 560,
        }}
        back={<DetailBackButton />}
        metadata={[
          { label: 'Genre', value: names(series.genres) },
          { label: 'Created by', value: names(series.directors) },
          { label: 'First aired', value: formatLongDate(series.firstAirDate) },
          { label: 'Rating', value: series.contentRating?.value ?? null },
        ]}
        title={title}
        tagline={series.tagline}
        synopsis={series.summary}
        actions={
          <>
            {playable?.fileId && (
              <Link
                to="/play/$mediaFileId"
                params={{ mediaFileId: playable.fileId }}
                search={{ position: playable.positionSeconds ?? undefined }}
                className={detailAction.primary}
              >
                <PlayGlyph />
                {playable.verb} {formatEpisodeLabel(playable.seasonNumber, playable.episodeNumber)}
              </Link>
            )}
            {bulkWatched.action}
          </>
        }
      />
      {bulkWatched.feedback}
      <ProgressDivider watched={watchedCount} total={episodes.length} />
      {seasons.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Seasons</h2>
          <div className={styles.seasonGrid}>
            {seasons.map((season) => (
              <Link
                key={season.id}
                to="/season/$seasonId"
                params={{ seasonId: season.id }}
                className={styles.cardLink}
              >
                <PosterCard
                  title={season.title ?? `Season ${season.seasonNumber}`}
                  meta={formatYear(season.airDate) ?? ''}
                  image={pickImageVariant(season.posterImages[0], 'MEDIUM')}
                  blurHash={season.posterImages[0]?.blurHash ?? null}
                  badge={seasonBadge(season)}
                  progressPercent={season.watchProgress?.percentComplete ?? undefined}
                />
              </Link>
            ))}
          </div>
        </section>
      )}
      {cast.length > 0 && (
        <div className={styles.cast}>
          <ContentShelf title="Cast">
            {cast.map((person) => (
              <CastCard
                key={person.id}
                name={person.name}
                image={pickImageVariant(person.images[0], 'SMALL')}
                blurHash={person.images[0]?.blurHash ?? null}
              />
            ))}
          </ContentShelf>
        </div>
      )}
      {bulkWatched.dialog}
    </>
  )
}

function seasonBadge(season: Season): WatchedBadgeProps | undefined {
  if (season.watchStatus === 'WATCHED') {
    return { status: 'watched' }
  }
  const unwatched = season.episodes.filter(
    (episode) => episode && episode.watchStatus !== 'WATCHED',
  ).length
  return unwatched > 0 ? { status: 'unwatched-count', count: unwatched } : undefined
}

function names(people: ReadonlyArray<{ name: string } | null>): string | null {
  const present = people
    .filter((entry): entry is { name: string } => entry !== null)
    .map((entry) => entry.name)
  return present.length > 0 ? present.join(', ') : null
}
