import { createFileRoute, type SearchSchemaInput } from '@tanstack/react-router'
import { useCallback } from 'react'
import { browserPlaybackPlatform } from '../../streaming/playbackCapabilities'
import { Player } from '../../streaming/Player'
import {
  type MediaTitleSearch,
  type PlayableMediaTitle,
  usePlayerTitle,
} from '../../streaming/usePlayerTitle'

type PlaySearch = { position?: number } & MediaTitleSearch

export const Route = createFileRoute('/_authenticated/play/$mediaFileId')({
  validateSearch: (search: PlaySearch & SearchSchemaInput): PlaySearch => ({
    position: parsePosition(search.position),
    movie: parseId(search.movie),
    episode: parseId(search.episode),
  }),
  component: Play,
})

function Play() {
  const { mediaFileId } = Route.useParams()
  const { position, movie, episode } = Route.useSearch()
  const { decodingAnswers } = Route.useRouteContext()
  // The player starts a new playback session whenever its binding changes.
  const playbackPlatform = useCallback(
    (video: HTMLVideoElement) => browserPlaybackPlatform(video, decodingAnswers),
    [decodingAnswers],
  )
  const mediaTitle = parseMediaTitle({ movie, episode })
  const title = usePlayerTitle(mediaTitle)
  return (
    <Player
      mediaFileId={mediaFileId}
      startPositionSeconds={position}
      title={title}
      mediaTitle={mediaTitle}
      playbackPlatform={playbackPlatform}
    />
  )
}

function parsePosition(value: unknown): number | undefined {
  const position = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(position) && position > 0 ? position : undefined
}

function parseId(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function parseMediaTitle({ movie, episode }: MediaTitleSearch): PlayableMediaTitle | undefined {
  if (movie && !episode) {
    return { kind: 'movie', id: movie }
  }
  if (episode && !movie) {
    return { kind: 'episode', id: episode }
  }
  return undefined
}
