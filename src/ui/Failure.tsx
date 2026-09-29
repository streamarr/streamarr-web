import { Button } from '@mantine/core'
import { useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useSignOut } from '../auth/useSignOut'
import { DetailBackButton } from '../media/DetailBack'
import styles from './Failure.module.css'

type WayOut = 'sign-out' | 'back'

/** A page that could not load: the cause in plain words, Retry, and a way out. */
export function FailurePanel({
  children,
  onRetry,
  wayOut = 'sign-out',
}: Readonly<{ children: ReactNode; onRetry?: () => unknown; wayOut?: WayOut }>) {
  return (
    <div className={styles.panel}>
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

function WayOutControl({ wayOut }: Readonly<{ wayOut: WayOut }>) {
  if (wayOut === 'back') {
    return <DetailBackButton />
  }

  return <SignOutButton />
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
