import { createFileRoute } from '@tanstack/react-router'
import { ShareOffersScreen } from '../../identity/ShareOffersScreen'

export const Route = createFileRoute('/_authenticated/settings/household/offers')({
  component: ShareOffersScreen,
})
