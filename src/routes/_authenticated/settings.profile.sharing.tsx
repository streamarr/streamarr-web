import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { SharingScreen } from '../../identity/SharingScreen'

interface SharingSearch {
  code?: string
}

export const Route = createFileRoute('/_authenticated/settings/profile/sharing')({
  validateSearch: (search: Record<string, unknown>): SharingSearch =>
    typeof search.code === 'string' ? { code: search.code } : {},
  component: SharingPage,
})

function SharingPage() {
  const { code } = Route.useSearch()
  const navigate = useNavigate()
  // Read once: taking the code out of the address below would otherwise take it from the form.
  const [arrivingCode] = useState(code ?? null)

  // A share code link opens the form once. A reload, the address bar and the history keep no code.
  useEffect(() => {
    if (code) {
      void navigate({ to: '/settings/profile/sharing', search: {}, replace: true })
    }
  }, [code, navigate])

  return <SharingScreen arrivingCode={arrivingCode} />
}
