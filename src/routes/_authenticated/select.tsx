import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Picker } from '../../identity/Picker'

export const Route = createFileRoute('/_authenticated/select')({
  component: Select,
})

function Select() {
  const navigate = useNavigate()
  return <Picker onProfileSelected={() => navigate({ to: '/' })} />
}
