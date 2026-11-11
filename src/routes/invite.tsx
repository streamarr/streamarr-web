import { AuthShell } from '../ui/AuthShell'
import { createFileRoute, useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { codeInFragment } from '../identity/fragmentCode'
import { InvitationScreen } from '../identity/InvitationScreen'

export const Route = createFileRoute('/invite')({
  component: Invite,
})

function Invite() {
  const navigate = useNavigate()
  // A link carries the code in its fragment, which a browser never sends to a server.
  const fragment = useLocation({ select: (location) => location.hash })
  // Read once: the effect below strips it from the URL, and the prefill must outlive that.
  const [initialCode] = useState(() => codeInFragment(fragment) || undefined)

  // A bearer capability that creates an account: keep it out of the address bar and history.
  useEffect(() => {
    if (codeInFragment(fragment) !== null) {
      void navigate({ to: '/invite', replace: true })
    }
  }, [fragment, navigate])

  // Acceptance signs the new person in (ACCOUNT scope), so the picker is always the next stop.
  return (
    <AuthShell width={480}>
      <InvitationScreen
        initialCode={initialCode}
        onAccepted={() => navigate({ to: '/select-profile' })}
      />
    </AuthShell>
  )
}
