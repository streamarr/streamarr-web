import { AuthShell } from '../ui/AuthShell'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
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
  // Read once: the effect below strips it from the URL, and the prefill must outlive that.
  const [initialCode] = useState(code)

  // A bearer capability that creates an account: keep it out of the address bar and history.
  useEffect(() => {
    if (code) {
      void navigate({ to: '/invite', search: {}, replace: true })
    }
  }, [code, navigate])

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
