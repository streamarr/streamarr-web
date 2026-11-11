import { createFileRoute } from '@tanstack/react-router'
import { SharingAndInvitationSettings } from '../../admin/sharing/SharingAndInvitationSettings'

export const Route = createFileRoute('/_authenticated/settings/server/sharing')({
  component: SharingAndInvitationSettings,
})
