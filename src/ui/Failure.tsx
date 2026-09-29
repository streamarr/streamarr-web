import { Button } from '@mantine/core'
import { useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useSignOut } from '../auth/useSignOut'
import styles from './Failure.module.css'

/** A page that could not load: the cause in plain words, Retry, and a way out. */
export function FailurePanel({
  children,
  onRetry,
}: Readonly<{ children: ReactNode; onRetry?: () => unknown }>) {
  return (
    <div className={styles.panel}>
      <p role="alert" className={styles.panelCause}>
        {children}
      </p>
      <div className={styles.actions}>
        {onRetry && <RetryButton onRetry={onRetry} />}
        <SignOutButton />
      </div>
    </div>
  )
}

function RetryButton({ onRetry }: Readonly<{ onRetry: () => unknown }>) {
  // A retry that fails again reports through the request's own error state.
  function retry() {
    void Promise.resolve(onRetry()).catch(() => undefined)
  }

  return <Button onClick={retry}>Retry</Button>
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
