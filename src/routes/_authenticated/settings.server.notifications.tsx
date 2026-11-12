import { createFileRoute } from '@tanstack/react-router'
import { NotificationSettings } from '../../admin/notifications/NotificationSettings'

export const Route = createFileRoute('/_authenticated/settings/server/notifications')({
  component: NotificationSettings,
})
