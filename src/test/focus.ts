import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { expect } from 'vitest'

/** Counts each time `element` takes focus, as a screen reader hears it, however briefly. */
export function focusesOf(element: HTMLElement): { count: number } {
  const focuses = { count: 0 }
  element.addEventListener('focus', () => {
    focuses.count += 1
  })
  return focuses
}

/** The ways to leave a confirmation without confirming: its dismiss button, by name, or Escape. */
export type WayOut = 'Cancel' | 'Keep offer' | 'Escape'

/** Leaves the open confirmation by `way`, and waits until it has closed. */
export async function leaveTheConfirmation(user: UserEvent, way: WayOut) {
  const dialog = screen.getByRole('dialog')
  if (way === 'Escape') {
    await user.keyboard('{Escape}')
  } else {
    await user.click(within(dialog).getByRole('button', { name: way }))
  }
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}
