import {
  isWatched,
  watchStateOf,
  type WithSelectedProfileWatchState,
} from './selectedProfileWatchState'

interface WatchStateLike {
  watchStatus: string
  watchProgress: { positionSeconds: number; durationSeconds?: number } | null | undefined
}

interface EpisodeLike extends WithSelectedProfileWatchState<WatchStateLike> {
  id: string
  episodeNumber: number
  files: ReadonlyArray<{ id: string } | null>
}

interface SeasonLike {
  seasonNumber: number
  episodes: ReadonlyArray<EpisodeLike | null>
}

export interface PlayableEpisode {
  id: string
  seasonNumber: number
  episodeNumber: number
  fileId: string | null
  positionSeconds: number | null
  /** The episode's progress when it is resumed, for the time left on the action. */
  progress: { positionSeconds: number; durationSeconds: number } | null
  verb: 'Resume' | 'Continue' | 'Play'
}

// Resume = a stream mid-watch, Continue = the next unwatched episode (principle 14); a series
// nothing has been watched in, or one that is finished, offers its first episode.
export function nextPlayableEpisode(
  seasons: ReadonlyArray<SeasonLike | null>,
): PlayableEpisode | null {
  const ordered = seasons
    .filter((season): season is SeasonLike => season !== null)
    .toSorted((a, b) => a.seasonNumber - b.seasonNumber)
    .flatMap((season) =>
      season.episodes
        .filter((episode): episode is EpisodeLike => episode !== null)
        .toSorted((a, b) => a.episodeNumber - b.episodeNumber)
        .map((episode) => ({ season, episode })),
    )
  const available = ordered.filter(({ episode }) => episode.files.some((file) => file !== null))
  if (available.length === 0) {
    return null
  }

  const inProgress = available.find(({ episode }) => {
    const watchState = watchStateOf(episode)
    return (
      watchState?.watchStatus === 'IN_PROGRESS' ||
      (watchState?.watchProgress?.positionSeconds ?? 0) > 0
    )
  })
  if (inProgress) {
    return playable(inProgress, 'Resume')
  }

  const unwatched = available.find(({ episode }) => !isWatched(episode))
  if (unwatched) {
    const anyWatched = ordered.some(({ episode }) => isWatched(episode))
    return playable(unwatched, anyWatched ? 'Continue' : 'Play')
  }

  return playable(available[0], 'Play')
}

function playable(
  { season, episode }: { season: SeasonLike; episode: EpisodeLike },
  verb: PlayableEpisode['verb'],
): PlayableEpisode {
  return {
    id: episode.id,
    seasonNumber: season.seasonNumber,
    episodeNumber: episode.episodeNumber,
    fileId: episode.files.find((file): file is { id: string } => file !== null)?.id ?? null,
    positionSeconds:
      verb === 'Resume' ? watchStateOf(episode)?.watchProgress?.positionSeconds || null : null,
    progress: verb === 'Resume' ? resumedProgress(watchStateOf(episode)?.watchProgress) : null,
    verb,
  }
}

function resumedProgress(progress: WatchStateLike['watchProgress']): PlayableEpisode['progress'] {
  if (!progress?.durationSeconds) return null
  return { positionSeconds: progress.positionSeconds, durationSeconds: progress.durationSeconds }
}
