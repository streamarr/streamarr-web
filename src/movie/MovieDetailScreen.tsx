import { useQuery } from '@apollo/client/react'
import { Alert, Center, Loader } from '@mantine/core'
import { Link } from '@tanstack/react-router'
import { MovieDetailDocument, type MovieDetailQuery } from '../graphql/generated/graphql'
import { AmbientScope } from '../media/AmbientScope'
import { resolveAmbientColors } from '../media/ambientSource'
import { CastCard } from '../media/CastCard'
import { ContentShelf } from '../media/ContentShelf'
import { DetailBackButton } from '../media/DetailBack'
import { detailAction, DetailHeader } from '../media/DetailHeader'
import { formatLongDate, formatRuntime, formatYear } from '../media/formatting'
import { CheckCircleGlyph, PlayGlyph } from '../media/glyphs'
import { pickImageVariant } from '../media/images'
import { RatingChipRow } from '../media/RatingChipRow'
import { useWatchedToggle } from '../media/useWatchedToggle'
import styles from './MovieDetailScreen.module.css'

type Movie = NonNullable<MovieDetailQuery['movie']>

export function MovieDetailScreen({ movieId }: { movieId: string }) {
  const { data, loading, error } = useQuery(MovieDetailDocument, { variables: { id: movieId } })
  const watched = useWatchedToggle(movieId, MovieDetailDocument)

  if (loading) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    )
  }

  const movie = data?.movie
  if (error || !movie) {
    return (
      <Alert color="red" role="alert">
        Couldn't load this movie. Try again.
      </Alert>
    )
  }

  const artwork = movie.backdropImages[0] ?? movie.posterImages[0] ?? null
  const ambient = resolveAmbientColors(movie.backdropImages, movie.posterImages)
  const position = movie.watchProgress?.positionSeconds || null
  const fileId = movie.files[0]?.id ?? null
  const isWatched = movie.watchStatus === 'WATCHED'
  const cast = movie.cast.filter((person): person is NonNullable<Movie['cast'][number]> => person !== null)

  return (
    <AmbientScope theme={ambient?.theme ?? null}>
      <DetailHeader
        backdrop={{
          image: pickImageVariant(artwork, 'LARGE'),
          blurHash: artwork?.blurHash ?? null,
          corners: ambient,
          height: 400,
        }}
        back={<DetailBackButton />}
        metadata={[
          { label: 'Genre', value: names(movie.genres) },
          { label: 'Directed by', value: names(movie.directors) },
          { label: 'Released', value: formatLongDate(movie.releaseDate) },
          { label: 'Rating', value: movie.contentRating?.value ?? null },
        ]}
        title={movie.title ?? 'Untitled'}
        tagline={movie.tagline}
        metaLine={present([
          formatYear(movie.releaseDate),
          movie.runtime != null ? formatRuntime(movie.runtime) : null,
          movie.contentRating?.value ?? null,
        ])}
        synopsis={movie.summary}
        actions={
          <>
            {fileId && (
              <Link
                to="/play/$mediaFileId"
                params={{ mediaFileId: fileId }}
                search={{ position: position ?? undefined }}
                className={detailAction.primary}
              >
                <PlayGlyph />
                {position ? 'Resume' : 'Play'}
              </Link>
            )}
            <button
              type="button"
              className={detailAction.outline}
              disabled={watched.pending}
              onClick={isWatched ? watched.markUnwatched : watched.markWatched}
            >
              <CheckCircleGlyph />
              {isWatched ? 'Mark unwatched' : 'Mark watched'}
            </button>
          </>
        }
        aside={<RatingChipRow ratings={movie.ratings} />}
      />
      {watched.failed && (
        <Alert color="red" role="alert" className={styles.notice}>
          Couldn't update the watched state. Try again.
        </Alert>
      )}
      {cast.length > 0 && (
        <div className={styles.section}>
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
    </AmbientScope>
  )
}

function names(people: ReadonlyArray<{ name: string } | null>): string | null {
  const present = people.filter((entry): entry is { name: string } => entry !== null).map((entry) => entry.name)
  return present.length > 0 ? present.join(', ') : null
}

function present(values: (string | null)[]): string[] {
  return values.filter((value): value is string => value !== null)
}
