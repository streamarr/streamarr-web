import { createFileRoute } from '@tanstack/react-router'
import { NotificationsScreen } from '../../notifications/NotificationsScreen'

export const Route = createFileRoute('/_authenticated/notifications')({
  component: NotificationsScreen,
})
