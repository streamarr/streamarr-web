import type { AdminLibraryFieldsFragment } from '../../graphql/generated/graphql'
import type { IconName } from '../../ui/Icon'

/**
 * Library configuration and maintenance state selected by the pinned GraphQL operation: what every
 * Profile reads, plus the administration facts only a ServerAdmin reads.
 */
export type ManagedLibrary = AdminLibraryFieldsFragment & {
  administration: NonNullable<AdminLibraryFieldsFragment['administration']>
}

type LibraryAdministration = ManagedLibrary['administration']

/**
 * Whether the server resolved the library's administration facts. The server answers null, with
 * an error, only when it refused or failed to resolve them.
 */
export function isManagedLibrary(library: AdminLibraryFieldsFragment): library is ManagedLibrary {
  return library.administration !== null
}

/** One semantic icon per server status. */
export const LIBRARY_STATUS_ICONS = {
  HEALTHY: 'check',
  SCANNING: 'scan',
  REFRESHING: 'refresh',
  // Stop scan and Stop refresh share this glyph. A stop never resumes, so pause never means stop.
  STOPPING: 'stop',
  UNHEALTHY: 'alert',
} as const satisfies Record<string, IconName>

/** The run a ServerAdmin can stop: the library's scan or its metadata refresh. */
export type StoppableRun = 'scan' | 'refresh'

/** The run the library's status says is in progress, which only that run's stop can end. */
export function stoppableRun(library: Pick<LibraryAdministration, 'status'>): StoppableRun | null {
  if (library.status === 'SCANNING') return 'scan'
  if (library.status === 'REFRESHING') return 'refresh'
  return null
}

/** Future states conservatively disable maintenance until the client understands them. */
export function canMaintainLibrary(library: Pick<LibraryAdministration, 'status'>): boolean {
  return library.status === 'HEALTHY' || library.status === 'UNHEALTHY'
}

/** Stable display name for the nullable server field, including imported legacy libraries. */
export function libraryName(library: Pick<ManagedLibrary, 'name'>): string {
  return library.name?.trim() || 'Unnamed library'
}

/** Unknown media types remain representable without impersonating a movie or TV library. */
export function libraryIcon(type: ManagedLibrary['type']): IconName {
  if (type === 'MOVIE') return 'movie'
  if (type === 'SERIES') return 'series'
  return 'folder'
}

/** Accessible media-type label, including a neutral fallback for future server types. */
export function libraryTypeLabel(type: ManagedLibrary['type']): string {
  if (type === 'MOVIE') return 'Movies'
  if (type === 'SERIES') return 'TV shows'
  return 'Library'
}

/** Last completed scan attempt, not a claim of success; absent and invalid values are explicit. */
export function lastScanLabel(
  library: Pick<LibraryAdministration, 'scanStartedOn' | 'scanCompletedOn'>,
): string {
  if (!library.scanCompletedOn)
    return library.scanStartedOn ? 'Not completed yet' : 'Not scanned yet'
  const date = new Date(library.scanCompletedOn)
  return Number.isNaN(date.getTime())
    ? 'Unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
