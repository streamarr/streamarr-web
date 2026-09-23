import { Modal } from '@mantine/core'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { DestructiveButton } from './DestructiveButton'
import styles from './ConfirmDialog.module.css'

/**
 * The one sanctioned modal: a bulk or destructive action confirms before it runs (principle 11.1).
 * The caller runs the request and closes on success; a pending request cannot be dismissed.
 */
export function ConfirmDialog({
  opened,
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
  destructive = false,
  pending = false,
  disabled = false,
  error,
  icon,
}: Readonly<{
  opened: boolean
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
  /** Use the shared contained red action treatment. */
  destructive?: boolean
  /** A submitted request is in flight; the dialog cannot be dismissed yet. */
  pending?: boolean
  /** Prevent confirmation when the underlying resource can no longer be changed. */
  disabled?: boolean
  /** Recoverable operation error, announced without closing the dialog. */
  error?: string | null
  /** The glyph beside the confirm label, or null for none. */
  icon: IconName | null
}>) {
  const content = (
    <>
      {icon && <Icon name={icon} size={16} />}
      {confirmLabel}
    </>
  )
  // In place rather than in a portal, so a page's ambient theme still reaches it.
  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!pending) onClose()
      }}
      closeOnEscape={!pending}
      closeOnClickOutside={!pending}
      title={title}
      centered
      withCloseButton={false}
      withinPortal={false}
      size={440}
      transitionProps={{ duration: 0 }}
      classNames={{
        inner: styles.inner,
        content: styles.content,
        header: styles.header,
        title: styles.title,
        body: styles.body,
      }}
    >
      <p className={styles.consequence}>{body}</p>
      {/* Mounted before the request starts, so the change of text is what gets announced. */}
      <output className={styles.status}>{pending ? 'Working…' : ''}</output>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.cancel}
          onClick={onClose}
          disabled={pending}
          data-autofocus
        >
          Cancel
        </button>
        {destructive ? (
          <DestructiveButton onClick={onConfirm} disabled={pending || disabled} aria-busy={pending}>
            {content}
          </DestructiveButton>
        ) : (
          <button
            type="button"
            className={styles.confirm}
            onClick={onConfirm}
            disabled={pending || disabled}
            aria-busy={pending}
          >
            {content}
          </button>
        )}
      </div>
    </Modal>
  )
}
