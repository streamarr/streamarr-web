import { createFileRoute } from '@tanstack/react-router'
import { LibraryWorkspace } from '../../admin/libraries/LibraryWorkspace'

export const Route = createFileRoute('/_authenticated/settings/server/libraries')({
  validateSearch: (search: Record<string, unknown>): { library?: string } => ({
    library: typeof search.library === 'string' && search.library ? search.library : undefined,
  }),
  component: Libraries,
})

function Libraries() {
  const { library } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <LibraryWorkspace
      selectedId={library}
      onSelect={(id) => void navigate({ search: { library: id || undefined } })}
    />
  )
}
