import type { ShownLibraryStatus } from './libraryModel'
import { LIBRARY_STATUS_ICONS } from './libraryModel'
import { Icon } from '../../ui/Icon'
import styles from './LibraryStatus.module.css'

/**
 * Library status: a compact system label and one semantic glyph, without a badge surface.
 * The known labels match the server verbatim. Future values, and a status the server could not
 * resolve, receive a neutral fallback.
 * Parents own announcements so only the selected detail status is announced.
 */
export function LibraryStatus({ status }: Readonly<{ status: ShownLibraryStatus }>) {
  const known = status !== null && Object.hasOwn(LIBRARY_STATUS_ICONS, status)
  const icon = known ? LIBRARY_STATUS_ICONS[status as keyof typeof LIBRARY_STATUS_ICONS] : 'alert'
  let tone = ''
  if (status === 'HEALTHY') tone = styles.healthy
  if (status === 'UNHEALTHY') tone = styles.unhealthy
  return (
    <span data-library-status className={`${styles.status} ${tone}`}>
      <Icon name={icon} size={14} />
      {known ? status : 'Status unavailable'}
    </span>
  )
}
