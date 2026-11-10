import { createFileRoute } from '@tanstack/react-router'
import { HouseholdSettings } from '../../identity/HouseholdSettings'

export const Route = createFileRoute('/_authenticated/settings/household')({
  component: HouseholdSettings,
})
