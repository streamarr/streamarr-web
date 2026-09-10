import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { LibraryScreen, type LibrarySearch } from '../../library/LibraryScreen'

const DEFAULT_SORT: Pick<LibrarySearch, 'by' | 'direction'> = { by: 'ADDED', direction: 'DESC' }

export const Route = createFileRoute('/_authenticated/library/$libraryId')({
  validateSearch: (search: Record<string, unknown>): LibrarySearch => ({
    by: isOrderMediaBy(search.by) ? search.by : DEFAULT_SORT.by,
    direction: isSortDirection(search.direction) ? search.direction : DEFAULT_SORT.direction,
    watchStatus: isWatchStatusFilter(search.watchStatus) ? search.watchStatus : undefined,
    letter: typeof search.letter === 'string' ? search.letter : undefined,
  }),
  component: LibraryRoute,
})

function LibraryRoute() {
  const { libraryId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()

  return (
    <LibraryScreen
      libraryId={libraryId}
      search={search}
      onSearchChange={(next) => navigate({ to: '/library/$libraryId', params: { libraryId }, search: next })}
    />
  )
}

function isOrderMediaBy(value: unknown): value is LibrarySearch['by'] {
  return value === 'TITLE' || value === 'ADDED' || value === 'RELEASE_DATE' || value === 'RUNTIME' || value === 'LAST_WATCHED'
}

function isSortDirection(value: unknown): value is LibrarySearch['direction'] {
  return value === 'ASC' || value === 'DESC'
}

function isWatchStatusFilter(value: unknown): value is LibrarySearch['watchStatus'] {
  return value === 'UNWATCHED' || value === 'IN_PROGRESS'
}
