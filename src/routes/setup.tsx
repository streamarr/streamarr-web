import { Center, Loader } from '@mantine/core'
import { AuthShell } from '../ui/AuthShell'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getSetupStatus } from '../auth/api'
import type { AuthTokens } from '../auth/api'
import { SetupForm } from '../auth/SetupForm'

export const Route = createFileRoute('/setup')({
  component: Setup,
})

function Setup() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)

  // First-run gate: once the server is set up, the wizard must never show again.
  useEffect(() => {
    getSetupStatus()
      .then((status) => (status.setupComplete ? navigate({ to: '/login' }) : setReady(true)))
      .catch(() => setReady(true))
  }, [navigate])

  function onAuthenticated(tokens: AuthTokens) {
    navigate({ to: tokens.scope === 'profile' ? '/' : '/select' })
  }

  if (!ready) {
    return (
      <AuthShell>
        <Center h={200}>
          <Loader />
        </Center>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <SetupForm onAuthenticated={onAuthenticated} />
    </AuthShell>
  )
}
