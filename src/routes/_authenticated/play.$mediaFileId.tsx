import { createFileRoute } from '@tanstack/react-router'
import { Player } from '../../streaming/Player'

export const Route = createFileRoute('/_authenticated/play/$mediaFileId')({
  component: Play,
})

function Play() {
  const { mediaFileId } = Route.useParams()
  return <Player mediaFileId={mediaFileId} />
}
