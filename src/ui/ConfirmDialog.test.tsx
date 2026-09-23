import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { ConfirmDialog } from './ConfirmDialog'

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  const rendered = renderWithProviders(
    <ConfirmDialog
      opened
      title="Mark Northern Line as watched?"
      body="Every episode across 12 seasons will be marked watched."
      confirmLabel="Mark watched"
      onConfirm={onConfirm}
      onClose={onClose}
      {...overrides}
    />,
  )
  return { ...rendered, onConfirm, onClose }
}

describe('ConfirmDialog', () => {
  it('presents the question, the consequence, and the two verbs', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'Mark Northern Line as watched?' })
    expect(dialog).toHaveTextContent('Every episode across 12 seasons will be marked watched.')
    expect(screen.getByRole('button', { name: 'Mark watched' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('confirms without closing on its own, leaving that to the caller', async () => {
    const { user, onConfirm, onClose } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Mark watched' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Cancel without confirming', async () => {
    const { user, onConfirm, onClose } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('renders nothing while closed', () => {
    renderDialog({ opened: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
