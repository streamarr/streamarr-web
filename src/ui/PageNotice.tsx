import styles from '../styles/settings.module.css'
import { Icon } from './Icon'

/** What a settings page says after a change took, under its heading until dismissed. */
export function PageNotice({
  children,
  onDismiss,
}: Readonly<{ children: string; onDismiss: () => void }>) {
  if (!children) return null
  return (
    <output className={styles.notice}>
      {children}
      <button type="button" aria-label="Dismiss notification" onClick={onDismiss}>
        <Icon name="close" size={16} />
      </button>
    </output>
  )
}
