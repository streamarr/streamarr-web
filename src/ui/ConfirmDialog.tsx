import { Modal } from '@mantine/core'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { DestructiveButton } from './DestructiveButton'
import styles from './ConfirmDialog.module.css'

/**
 * Explicit confirmation for a bulk or destructive action. The caller owns request execution
 * and closing on success. Pending requests prevent dismissal and duplicate confirmation;
 * failures remain in the dialog. Cancel receives initial focus and closing restores focus.
 * Renders in place to retain the page's ambient theme. Existing watched actions keep their icon.
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
  icon = 'watched-action',
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
  /** Null omits the action icon. Defaults to the existing watched-action glyph. */
  icon?: IconName | null
}>) {
  const content = (
    <>
      {icon && <Icon name={icon} size={16} />}
      {pending ? 'Working…' : confirmLabel}
    </>
  )
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
        content: styles.content,
        header: styles.header,
        title: styles.title,
        body: styles.body,
      }}
    >
      <p className={styles.consequence}>{body}</p>
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
