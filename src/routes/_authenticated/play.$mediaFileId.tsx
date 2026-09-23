import { createFileRoute } from '@tanstack/react-router'
import { Player } from '../../streaming/Player'

interface PlaySearch {
  position?: number
}

export const Route = createFileRoute('/_authenticated/play/$mediaFileId')({
  validateSearch: (search: Record<string, unknown>): PlaySearch => ({
    position: parsePosition(search.position),
  }),
  component: Play,
})

function Play() {
  const { mediaFileId } = Route.useParams()
  const { position } = Route.useSearch()
  return <Player mediaFileId={mediaFileId} startPositionSeconds={position} />
}

function parsePosition(value: unknown): number | undefined {
  const position = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(position) && position > 0 ? position : undefined
}
