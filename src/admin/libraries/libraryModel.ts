import type { ManagedLibraryFieldsFragment } from '../../graphql/generated/graphql'
import type { IconName } from '../../ui/Icon'

/** Library configuration and maintenance state selected by the pinned GraphQL operation. */
export type ManagedLibrary = ManagedLibraryFieldsFragment

/** One semantic icon per server status; shared by labels and the corresponding actions. */
export const LIBRARY_STATUS_ICONS = {
  HEALTHY: 'check',
  SCANNING: 'scan',
  REFRESHING: 'refresh',
  UNHEALTHY: 'alert',
} as const satisfies Record<string, IconName>

/** Future states conservatively disable maintenance until the client understands them. */
export function canMaintainLibrary(library: Pick<ManagedLibrary, 'status'>): boolean {
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
  library: Pick<ManagedLibrary, 'scanStartedOn' | 'scanCompletedOn'>,
): string {
  if (!library.scanCompletedOn)
    return library.scanStartedOn ? 'Not completed yet' : 'Not scanned yet'
  const date = new Date(library.scanCompletedOn)
  return Number.isNaN(date.getTime())
    ? 'Unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
