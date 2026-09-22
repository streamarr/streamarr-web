import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/settings/server/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/server/libraries' })
  },
})
