import { AuthShell } from '../../ui/AuthShell'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Picker } from '../../identity/Picker'

export const Route = createFileRoute('/_authenticated/select')({
  component: Select,
})

function Select() {
  const navigate = useNavigate()
  return (
    <AuthShell width={640}>
      <Picker onProfileSelected={() => navigate({ to: '/' })} />
    </AuthShell>
  )
}
