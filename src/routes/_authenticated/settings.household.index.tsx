import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/settings/household/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/household/offers' })
  },
})
