import { AuthShell } from '../ui/AuthShell'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { InvitationScreen } from '../identity/InvitationScreen'

export const Route = createFileRoute('/invite')({
  validateSearch: (search: Record<string, unknown>): { code?: string } => ({
    code: typeof search.code === 'string' && search.code.length > 0 ? search.code : undefined,
  }),
  component: Invite,
})

function Invite() {
  const navigate = useNavigate()
  const { code } = Route.useSearch()
  // Acceptance signs the new person in (ACCOUNT scope), so the picker is always the next stop.
  return (
    <AuthShell width={480}>
      <InvitationScreen initialCode={code} onAccepted={() => navigate({ to: '/select' })} />
    </AuthShell>
  )
}
