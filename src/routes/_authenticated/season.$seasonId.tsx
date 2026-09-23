import { createFileRoute } from '@tanstack/react-router'
import { SeasonDetailScreen } from '../../season/SeasonDetailScreen'

export const Route = createFileRoute('/_authenticated/season/$seasonId')({
  component: SeasonRoute,
})

function SeasonRoute() {
  const { seasonId } = Route.useParams()
  return <SeasonDetailScreen seasonId={seasonId} />
}
