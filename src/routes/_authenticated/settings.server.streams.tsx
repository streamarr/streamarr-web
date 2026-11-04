import { createFileRoute } from '@tanstack/react-router'
import { ActiveStreams } from '../../admin/streams/ActiveStreams'

export const Route = createFileRoute('/_authenticated/settings/server/streams')({
  component: ActiveStreams,
})
