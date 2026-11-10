import { createFileRoute } from '@tanstack/react-router'
import { SharingScreen } from '../../identity/SharingScreen'

export const Route = createFileRoute('/_authenticated/settings/profile/sharing')({
  component: SharingScreen,
})
