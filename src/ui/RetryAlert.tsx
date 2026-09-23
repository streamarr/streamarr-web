import { Alert, Button, type AlertProps } from '@mantine/core'
import type { ReactNode } from 'react'

/**
 * A failed load and its one way out. A retry that fails again reports through the query's own
 * error state, so its rejection is not surfaced here.
 */
export function RetryAlert({
  children,
  onRetry,
  mb,
}: Readonly<{ children: ReactNode; onRetry: () => Promise<unknown>; mb?: AlertProps['mb'] }>) {
  return (
    <Alert color="red" role="alert" mb={mb}>
      {children}{' '}
      <Button variant="default" onClick={() => void onRetry().catch(() => {})}>
        Try again
      </Button>
    </Alert>
  )
}
