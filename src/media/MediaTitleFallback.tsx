import { Alert, Center, Loader } from '@mantine/core'

export type MediaTitleKind = 'movie' | 'series' | 'season'

/** What a media title's page shows in place of the title while it loads or when it cannot. */
export function MediaTitleFallback({
  kind,
  loading,
}: Readonly<{ kind: MediaTitleKind; loading: boolean }>) {
  if (loading) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    )
  }

  return (
    <Alert color="red" role="alert">
      Couldn't load this {kind}. Try again.
    </Alert>
  )
}
