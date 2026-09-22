import type { ComponentPropsWithRef } from 'react'
import styles from './DestructiveButton.module.css'

/**
 * Contained destructive action using the shared semantic error colors. The caller must obtain
 * explicit confirmation before performing the operation. Native button props include disabled,
 * aria-busy and accessible naming; the ref supports returning focus after confirmation.
 */
export function DestructiveButton({
  className = '',
  type = 'button',
  ...props
}: Readonly<ComponentPropsWithRef<'button'>>) {
  return <button {...props} type={type} className={`${styles.button} ${className}`} />
}
