import { createFileRoute } from '@tanstack/react-router'
import { PlaybackReports } from '../../admin/reports/PlaybackReports'

export const Route = createFileRoute('/_authenticated/settings/server/reports')({
  component: PlaybackReports,
})
