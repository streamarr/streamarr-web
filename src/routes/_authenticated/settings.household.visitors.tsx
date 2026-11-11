import { createFileRoute } from '@tanstack/react-router'
import { SharedWithUsScreen } from '../../identity/SharedWithUsScreen'

export const Route = createFileRoute('/_authenticated/settings/household/visitors')({
  component: SharedWithUsScreen,
})
