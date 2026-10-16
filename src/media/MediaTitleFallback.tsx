import { Center, Loader } from '@mantine/core'
import type {
  MovieDetailQuery,
  SeasonDetailQuery,
  SeriesDetailQuery,
} from '../graphql/generated/graphql'
import { hasInvalidInputAt, requestFailureMessage } from '../graphql/requestErrors'
import { FailurePanel } from '../ui/Failure'

type MediaTitleKind = 'movie' | 'series' | 'season'

const SPOKEN_KIND: Record<MediaTitleKind, string> = {
  movie: 'movie',
  series: 'show',
  season: 'season',
}

// The server reports an id it cannot parse on the detail query's root field.
const ROOT_FIELD = {
  movie: 'movie',
  series: 'series',
  season: 'season',
} as const satisfies {
  movie: keyof MovieDetailQuery
  series: keyof SeriesDetailQuery
  season: keyof SeasonDetailQuery
}

/**
 * What a media title's page shows in place of the title while it loads or when it cannot. `title`
 * is the query's root field: null when the server has no such title.
 */
export function MediaTitleFallback({
  kind,
  loading,
  error,
  title,
  onRetry,
}: Readonly<{
  kind: MediaTitleKind
  loading: boolean
  error: unknown
  title: object | null | undefined
  onRetry: () => unknown
}>) {
  if (loading) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    )
  }

  // Retrying can never find a title the server has no record of, or an id it cannot parse.
  if (title === null || hasInvalidInputAt(error, ROOT_FIELD[kind])) {
    return (
      <FailurePanel wayOut="back">
        This {SPOKEN_KIND[kind]} doesn't exist or was removed.
      </FailurePanel>
    )
  }

  return (
    <FailurePanel onRetry={onRetry}>
      {requestFailureMessage(error, `Couldn't load this ${SPOKEN_KIND[kind]}.`)}
    </FailurePanel>
  )
}
