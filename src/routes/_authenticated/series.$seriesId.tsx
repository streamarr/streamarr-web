import { createFileRoute } from '@tanstack/react-router'
import { SeriesDetailScreen } from '../../series/SeriesDetailScreen'

export const Route = createFileRoute('/_authenticated/series/$seriesId')({
  component: SeriesRoute,
})

function SeriesRoute() {
  const { seriesId } = Route.useParams()
  return <SeriesDetailScreen seriesId={seriesId} />
}
