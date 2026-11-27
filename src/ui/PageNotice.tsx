import styles from '../styles/settings.module.css'
import { Icon } from './Icon'

/**
 * What a settings page says after a change took, under its heading until dismissed. The status is
 * always in the page, empty between notices, because a screen reader hears a status whose text
 * changes rather than one that arrives with its text. Each `count` writes its notice anew, so the
 * same words a second time are heard a second time.
 */
export function PageNotice({
  children,
  count = 0,
  onDismiss,
}: Readonly<{ children: string; count?: number; onDismiss: () => void }>) {
  return (
    <div className={children ? styles.notice : undefined}>
      <output>{children && <span key={count}>{children}</span>}</output>
      {children && (
        <button type="button" aria-label="Dismiss notification" onClick={onDismiss}>
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  )
}
