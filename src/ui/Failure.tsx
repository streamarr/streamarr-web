import { Button } from '@mantine/core'
import { useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useSignOut } from '../auth/useSignOut'
import { DetailBackButton } from '../media/DetailBack'
import styles from './Failure.module.css'

type WayOut = 'sign-out' | 'back'

/**
 * A page that could not load: the cause in plain words, Retry, and a way out. A `ceremony` panel
 * sits in the left-aligned column of an auth or pairing screen.
 */
export function FailurePanel({
  children,
  onRetry,
  wayOut = 'sign-out',
  layout = 'page',
}: Readonly<{
  children: ReactNode
  onRetry?: () => unknown
  wayOut?: WayOut
  layout?: 'page' | 'ceremony'
}>) {
  return (
    <div className={layout === 'ceremony' ? `${styles.panel} ${styles.ceremony}` : styles.panel}>
      <p role="alert" className={styles.panelCause}>
        {children}
      </p>
      <div className={styles.actions}>
        {onRetry && <RetryButton onRetry={onRetry} />}
        <WayOutControl wayOut={wayOut} />
      </div>
    </div>
  )
}

/** A section that could not load, inside a page that did: the cause and Retry. */
export function FailureRow({
  children,
  onRetry,
  className,
}: Readonly<{ children: ReactNode; onRetry: () => unknown; className?: string }>) {
  return (
    <div className={className ? `${styles.row} ${className}` : styles.row}>
      <p role="alert" className={styles.rowCause}>
        {children}
      </p>
      <RetryButton onRetry={onRetry} variant="default" />
    </div>
  )
}

function WayOutControl({ wayOut }: Readonly<{ wayOut: WayOut }>) {
  if (wayOut === 'back') {
    return <DetailBackButton />
  }

  return <SignOutButton />
}

function RetryButton({
  onRetry,
  variant = 'filled',
}: Readonly<{ onRetry: () => unknown; variant?: 'filled' | 'default' }>) {
  // A retry that fails again reports through the request's own error state.
  function retry() {
    void Promise.resolve(onRetry()).catch(() => undefined)
  }

  return (
    <Button variant={variant} onClick={retry}>
      Retry
    </Button>
  )
}

function SignOutButton() {
  const navigate = useNavigate()
  const signOut = useSignOut(() => void navigate({ to: '/login' }))
  return (
    <Button variant="default" onClick={signOut}>
      Sign out
    </Button>
  )
}
