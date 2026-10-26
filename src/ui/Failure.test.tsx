import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { deferred } from '../test/deferred'
import { renderWithProviders } from '../test/render'
import { FailureRow } from './Failure'

describe('FailureRow', () => {
  it.each(['success', 'failure'])('shouldShowPendingRetryUntil%sSettles', async (outcome) => {
    const pending = deferred()
    const { user } = renderWithProviders(
      <FailureRow
        onRetry={async () => {
          await pending.promise
          if (outcome === 'failure') throw new Error('Still unavailable')
        }}
      >
        Still unavailable
      </FailureRow>,
    )
    const retry = screen.getByRole('button', { name: 'Retry' })
    await user.click(retry)
    try {
      expect(retry).toBeDisabled()
      expect(retry).toHaveAttribute('aria-busy', 'true')
      expect(screen.getByRole('alert')).toHaveTextContent('Still unavailable')
    } finally {
      pending.resolve()
    }
    await waitFor(() => expect(retry).toBeEnabled())
    expect(retry).toHaveAttribute('aria-busy', 'false')
  })
})
