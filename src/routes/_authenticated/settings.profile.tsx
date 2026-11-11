import { createFileRoute } from '@tanstack/react-router'
import { ProfileSettings } from '../../profile/ProfileSettings'

export const Route = createFileRoute('/_authenticated/settings/profile')({
  component: ProfileSettings,
})
