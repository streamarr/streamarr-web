import { createFileRoute } from '@tanstack/react-router'
import { PlaybackReportDetail } from '../../admin/reports/PlaybackReportDetail'

export const Route = createFileRoute('/_authenticated/settings/server/reports_/$reportId')({
  component: SharedReport,
})

function SharedReport() {
  const { reportId } = Route.useParams()
  return <PlaybackReportDetail key={reportId} reportId={reportId} />
}
