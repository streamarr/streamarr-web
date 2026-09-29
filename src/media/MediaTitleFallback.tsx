import { Center, Loader } from '@mantine/core'
import { requestFailureMessage } from '../graphql/requestErrors'
import { FailurePanel } from '../ui/Failure'

export type MediaTitleKind = 'movie' | 'series' | 'season'

const SPOKEN_KIND: Record<MediaTitleKind, string> = {
  movie: 'movie',
  series: 'show',
  season: 'season',
}

/** What a media title's page shows in place of the title while it loads or when it cannot. */
export function MediaTitleFallback({
  kind,
  loading,
  error,
  onRetry,
}: Readonly<{
  kind: MediaTitleKind
  loading: boolean
  error: unknown
  onRetry: () => unknown
}>) {
  if (loading) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    )
  }

  return (
    <FailurePanel onRetry={onRetry}>
      {requestFailureMessage(error, `Couldn't load this ${SPOKEN_KIND[kind]}.`)}
    </FailurePanel>
  )
}
