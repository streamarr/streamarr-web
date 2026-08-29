import { useQuery } from '@apollo/client/react'
import { Alert, Center, Loader } from '@mantine/core'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { SeriesDetailDocument, type SeriesDetailQuery } from '../graphql/generated/graphql'
import { AmbientScope } from '../media/AmbientScope'
import { resolveAmbientColors } from '../media/ambientSource'
import { CastCard } from '../media/CastCard'
import { ContentShelf } from '../media/ContentShelf'
import { DetailBackButton } from '../media/DetailBack'
import { detailAction, DetailHeader } from '../media/DetailHeader'
import { formatEpisodeLabel, formatLongDate, formatYear } from '../media/formatting'
import { CheckCircleGlyph, PlayGlyph } from '../media/glyphs'
import { pickImageVariant } from '../media/images'
import { nextPlayableEpisode } from '../media/nextPlayableEpisode'
import { PosterCard } from '../media/PosterCard'
import { ProgressDivider } from '../media/ProgressDivider'
import { useWatchedToggle } from '../media/useWatchedToggle'
import type { WatchedBadgeProps } from '../media/WatchedBadge'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import styles from './SeriesDetailScreen.module.css'

type Series = NonNullable<SeriesDetailQuery['series']>
type Season = NonNullable<Series['seasons'][number]>
type Episode = NonNullable<Season['episodes'][number]>

type BulkVerb = 'watched' | 'unwatched'

export function SeriesDetailScreen({ seriesId }: { seriesId: string }) {
  const { data, loading, error } = useQuery(SeriesDetailDocument, { variables: { id: seriesId } })
  const watched = useWatchedToggle(seriesId, SeriesDetailDocument)
  const [confirming, setConfirming] = useState<BulkVerb | null>(null)

  if (loading) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    )
  }

  const series = data?.series
  if (error || !series) {
    return (
      <Alert color="red" role="alert">
        Couldn't load this series. Try again.
      </Alert>
    )
  }

  const title = series.title ?? 'Untitled'
  const seasons = series.seasons.filter((season): season is Season => season !== null)
  const episodes = seasons.flatMap((season) => season.episodes.filter((episode): episode is Episode => episode !== null))
  const watchedCount = episodes.filter((episode) => episode.watchStatus === 'WATCHED').length
  const playable = nextPlayableEpisode(seasons)
  const isWatched = series.watchStatus === 'WATCHED'
  const artwork = series.backdropImages[0] ?? series.posterImages[0] ?? null
  const ambient = resolveAmbientColors(series.backdropImages, series.posterImages)
  const cast = series.cast.filter((person): person is NonNullable<Series['cast'][number]> => person !== null)

  // A bulk action confirms before it runs (principle 11.1) — in both directions, since
  // unmarking wipes progress across every episode just as marking sets it.
  function confirmBulk() {
    const action = confirming === 'unwatched' ? watched.markUnwatched : watched.markWatched
    setConfirming(null)
    void action()
  }

  return (
    <AmbientScope theme={ambient?.theme ?? null}>
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
            <button
              type="button"
              className={detailAction.outline}
              disabled={watched.pending}
              onClick={() => setConfirming(isWatched ? 'unwatched' : 'watched')}
            >
              <CheckCircleGlyph />
              {isWatched ? 'Mark series unwatched' : 'Mark series watched'}
            </button>
          </>
        }
      />
      {watched.failed && (
        <Alert color="red" role="alert" className={styles.notice}>
          Couldn't update the watched state. Try again.
        </Alert>
      )}
      <ProgressDivider watched={watchedCount} total={episodes.length} />
      {seasons.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Seasons</h2>
          <div className={styles.seasonGrid}>
            {seasons.map((season) => (
              <PosterCard
                key={season.id}
                title={season.title ?? `Season ${season.seasonNumber}`}
                meta={formatYear(season.airDate) ?? ''}
                image={pickImageVariant(season.posterImages[0], 'MEDIUM')}
                blurHash={season.posterImages[0]?.blurHash ?? null}
                badge={seasonBadge(season)}
                progressPercent={season.watchProgress?.percentComplete ?? undefined}
              />
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
      <ConfirmDialog
        opened={confirming !== null}
        title={`Mark ${title} as ${confirming ?? 'watched'}?`}
        body={`All ${seasons.length} seasons — ${episodes.length} episodes — will be marked ${confirming ?? 'watched'}.`}
        confirmLabel={confirming === 'unwatched' ? 'Mark unwatched' : 'Mark watched'}
        onConfirm={confirmBulk}
        onClose={() => setConfirming(null)}
      />
    </AmbientScope>
  )
}

function seasonBadge(season: Season): WatchedBadgeProps | undefined {
  if (season.watchStatus === 'WATCHED') {
    return { status: 'watched' }
  }
  const unwatched = season.episodes.filter((episode) => episode && episode.watchStatus !== 'WATCHED').length
  return unwatched > 0 ? { status: 'unwatched-count', count: unwatched } : undefined
}

function names(people: ReadonlyArray<{ name: string } | null>): string | null {
  const present = people.filter((entry): entry is { name: string } => entry !== null).map((entry) => entry.name)
  return present.length > 0 ? present.join(', ') : null
}
