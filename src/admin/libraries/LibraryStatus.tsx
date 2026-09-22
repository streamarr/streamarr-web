import type { ManagedLibrary } from './libraryModel'
import { LIBRARY_STATUS_ICONS } from './libraryModel'
import { Icon } from '../../ui/Icon'
import styles from './LibraryStatus.module.css'

/**
 * D3 library status: a compact system label and one semantic glyph, without a badge surface.
 * The four known labels match the server verbatim. Future values receive a neutral fallback.
 * Parents own announcements so only the selected detail status is announced.
 */
export function LibraryStatus({ status }: Readonly<{ status: ManagedLibrary['status'] }>) {
  const known = Object.hasOwn(LIBRARY_STATUS_ICONS, status)
  const icon = known ? LIBRARY_STATUS_ICONS[status as keyof typeof LIBRARY_STATUS_ICONS] : 'alert'
  const tone =
    status === 'HEALTHY' ? styles.healthy : status === 'UNHEALTHY' ? styles.unhealthy : ''
  return (
    <span data-library-status className={`${styles.status} ${tone}`}>
      <Icon name={icon} size={14} />
      {known ? status : 'Status unavailable'}
    </span>
  )
}
