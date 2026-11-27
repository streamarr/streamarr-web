import { AuthShell } from '../ui/AuthShell'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { InvitationScreen } from '../identity/InvitationScreen'
import { useLinkCode } from '../identity/useLinkCode'

export const Route = createFileRoute('/invite')({
  component: Invite,
})

// The code is a bearer capability that creates an account: the address bar and history keep none.
function Invite() {
  const navigate = useNavigate()
  const { code, arrivals } = useLinkCode()

  // Acceptance signs the new person in (ACCOUNT scope), so the picker is always the next stop.
  return (
    <AuthShell width={480}>
      <InvitationScreen
        key={arrivals}
        initialCode={code || undefined}
        onAccepted={() => navigate({ to: '/select-profile' })}
      />
    </AuthShell>
  )
}
