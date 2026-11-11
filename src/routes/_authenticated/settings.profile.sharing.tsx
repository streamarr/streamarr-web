import { createFileRoute, useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { codeInFragment } from '../../identity/shareCode'
import { SharingScreen } from '../../identity/SharingScreen'

export const Route = createFileRoute('/_authenticated/settings/profile/sharing')({
  component: SharingPage,
})

function SharingPage() {
  const fragment = useLocation({ select: (location) => location.hash })
  const navigate = useNavigate()
  // Read once: taking the code out of the address below would otherwise take it from the form.
  const [arrivingCode] = useState(() => codeInFragment(fragment))

  // A share code link opens the form once. A reload, the address bar and the history keep no code.
  useEffect(() => {
    if (codeInFragment(fragment) !== null) {
      void navigate({ to: '/settings/profile/sharing', replace: true })
    }
  }, [fragment, navigate])

  return <SharingScreen arrivingCode={arrivingCode} />
}
