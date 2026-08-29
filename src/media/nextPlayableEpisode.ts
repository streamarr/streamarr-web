interface EpisodeLike {
  id: string
  episodeNumber: number
  watchStatus: string
  watchProgress: { positionSeconds: number } | null | undefined
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
  verb: 'Resume' | 'Continue' | 'Play'
}

// Resume = a stream mid-watch, Continue = the next unwatched episode (principle 14); a series
// nothing has been watched in, or one that is finished, offers its first episode.
export function nextPlayableEpisode(seasons: ReadonlyArray<SeasonLike | null>): PlayableEpisode | null {
  const ordered = seasons
    .filter((season): season is SeasonLike => season !== null)
    .toSorted((a, b) => a.seasonNumber - b.seasonNumber)
    .flatMap((season) =>
      season.episodes
        .filter((episode): episode is EpisodeLike => episode !== null)
        .toSorted((a, b) => a.episodeNumber - b.episodeNumber)
        .map((episode) => ({ season, episode })),
    )
  if (ordered.length === 0) {
    return null
  }

  const inProgress = ordered.find(
    ({ episode }) => episode.watchStatus === 'IN_PROGRESS' || (episode.watchProgress?.positionSeconds ?? 0) > 0,
  )
  if (inProgress) {
    return playable(inProgress, 'Resume')
  }

  const unwatched = ordered.find(({ episode }) => episode.watchStatus !== 'WATCHED')
  if (unwatched) {
    const anyWatched = ordered.some(({ episode }) => episode.watchStatus === 'WATCHED')
    return playable(unwatched, anyWatched ? 'Continue' : 'Play')
  }

  return playable(ordered[0], 'Play')
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
    positionSeconds: verb === 'Resume' ? episode.watchProgress?.positionSeconds || null : null,
    verb,
  }
}
