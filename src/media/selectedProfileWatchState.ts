/** A media title as a query selects it: its watch state sits under the selected Profile's state. */
export interface WithSelectedProfileWatchState<WatchState> {
  selectedProfileState?: { watchState: WatchState } | null
}

/**
 * The selected Profile's watch state of a title, or undefined when the server sent no selected
 * Profile state. Callers read a title without one as unwatched with no resume position.
 */
export function watchStateOf<WatchState>(
  title: WithSelectedProfileWatchState<WatchState>,
): WatchState | undefined {
  return title.selectedProfileState?.watchState
}

export function isWatched(title: WithSelectedProfileWatchState<{ watchStatus: string }>): boolean {
  return watchStateOf(title)?.watchStatus === 'WATCHED'
}
