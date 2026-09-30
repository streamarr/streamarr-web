import { skipToken, useQuery } from '@apollo/client/react'
import { PlayerMediaTitleDocument, type PlayerMediaTitleQuery } from '../graphql/generated/graphql'
import { formatEpisodeLabel } from '../media/formatting'
import type { PlayerTitle } from './PlayerControls'

/** A media title that owns media files: the movie, or the episode, that a Play link opens. */
export interface PlayableMediaTitle {
  kind: 'movie' | 'episode'
  id: string
}

/** How a Play link names the media title it opens: its id, under its kind. */
export type MediaTitleSearch = Partial<Record<PlayableMediaTitle['kind'], string>>

/**
 * The title line's text for the media title being played. There is none while it loads or when it
 * cannot be read: playback never waits on the title.
 */
export function usePlayerTitle(
  mediaTitle: PlayableMediaTitle | undefined,
): PlayerTitle | undefined {
  const { data } = useQuery(
    PlayerMediaTitleDocument,
    mediaTitle
      ? { variables: { id: mediaTitle.id, movie: mediaTitle.kind === 'movie' } }
      : skipToken,
  )
  // With skipToken, Apollo keeps returning the last result. That result names the previous media title.
  return mediaTitle && data && playerTitleFrom(data)
}

function playerTitleFrom({ movie, episode }: PlayerMediaTitleQuery): PlayerTitle | undefined {
  if (movie) {
    return { heading: movie.title ?? 'Untitled' }
  }
  if (!episode) {
    return undefined
  }
  const label = formatEpisodeLabel(episode.season.seasonNumber, episode.episodeNumber)
  return {
    heading: episode.season.series.title ?? 'Untitled',
    detail: episode.title ? `${label} — ${episode.title}` : label,
  }
}
