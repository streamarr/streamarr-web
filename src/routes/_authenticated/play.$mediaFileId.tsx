import { createFileRoute, type SearchSchemaInput } from '@tanstack/react-router'
import { Player } from '../../streaming/Player'
import { type PlayableMediaTitle, usePlayerTitle } from '../../streaming/usePlayerTitle'

// A Play link names the media title it opens by its kind, as `movie` or `episode`.
interface PlaySearchParams {
  position?: number
  movie?: string
  episode?: string
}

interface PlaySearch {
  position?: number
  mediaTitle?: PlayableMediaTitle
}

export const Route = createFileRoute('/_authenticated/play/$mediaFileId')({
  validateSearch: (search: PlaySearchParams & SearchSchemaInput): PlaySearch => ({
    position: parsePosition(search.position),
    mediaTitle: parseMediaTitle(search),
  }),
  component: Play,
})

function Play() {
  const { mediaFileId } = Route.useParams()
  const { position, mediaTitle } = Route.useSearch()
  const title = usePlayerTitle(mediaTitle)
  return <Player mediaFileId={mediaFileId} startPositionSeconds={position} title={title} />
}

function parsePosition(value: unknown): number | undefined {
  const position = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(position) && position > 0 ? position : undefined
}

// A link that names both a movie and an episode names neither reliably.
function parseMediaTitle({
  movie,
  episode,
}: {
  movie?: unknown
  episode?: unknown
}): PlayableMediaTitle | undefined {
  if (isId(movie) && episode === undefined) {
    return { kind: 'movie', id: movie }
  }
  if (isId(episode) && movie === undefined) {
    return { kind: 'episode', id: episode }
  }
  return undefined
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}
