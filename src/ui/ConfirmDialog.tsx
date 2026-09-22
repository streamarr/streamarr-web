import { Modal } from '@mantine/core'
import { Icon } from './Icon'
import styles from './ConfirmDialog.module.css'

// The one sanctioned modal: a bulk or one-way action confirms before it runs (principle 11.1).
// It renders in place rather than in a portal so a page's ambient theme still reaches it.
export function ConfirmDialog({
  opened,
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: Readonly<{
  opened: boolean
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}>) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      centered
      withCloseButton={false}
      withinPortal={false}
      size={440}
      transitionProps={{ duration: 0 }}
      classNames={{
        content: styles.content,
        header: styles.header,
        title: styles.title,
        body: styles.body,
      }}
    >
      <p className={styles.consequence}>{body}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.cancel} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={styles.confirm} onClick={onConfirm}>
          <Icon name="watched-action" size={16} />
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
