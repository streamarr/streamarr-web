import { createFileRoute } from '@tanstack/react-router'
import { CreateLibrary } from '../../admin/libraries/CreateLibrary'

export const Route = createFileRoute('/_authenticated/settings/server/libraries_/new')({
  component: NewLibrary,
})

function NewLibrary() {
  const navigate = Route.useNavigate()
  return (
    <CreateLibrary
      onCreated={(id) =>
        void navigate({ to: '/settings/server/libraries', search: { library: id }, replace: true })
      }
    />
  )
}
