import { createFileRoute } from '@tanstack/react-router'
import { ServerSettings } from '../../admin/ServerSettings'

export const Route = createFileRoute('/_authenticated/settings/server')({
  component: ServerSettings,
})
