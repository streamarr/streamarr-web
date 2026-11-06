import type { WatchStatus } from '../graphql/generated/graphql'

// A media title's state for the selected Profile, as every query and change selects it. Each
// query picks the fields it selected; the cache ignores the rest.

interface WatchStateOverrides<Progress> {
  watchStatus?: WatchStatus
  watchProgress?: Progress | null
  lastWatchedAt?: string | null
}

export function selectedProfileState<Progress = never>({
  watchStatus = 'UNWATCHED',
  watchProgress = null,
  lastWatchedAt = null,
}: WatchStateOverrides<Progress> = {}) {
  return {
    __typename: 'SelectedProfileState' as const,
    watchState: { __typename: 'WatchState' as const, watchStatus, watchProgress, lastWatchedAt },
  }
}
