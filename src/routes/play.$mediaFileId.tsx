import { createFileRoute } from '@tanstack/react-router'
import { Player } from '../streaming/Player'

export const Route = createFileRoute('/play/$mediaFileId')({
  component: Play,
})

function Play() {
  const { mediaFileId } = Route.useParams()
  return <Player mediaFileId={mediaFileId} />
}
