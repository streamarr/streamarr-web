import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { ResetPasswordScreen } from './ResetPasswordScreen'

const CODE = 'reset-1234.super-secret'

describe('ResetPasswordScreen', () => {
  it('shouldChangeThePasswordAndPointAtSignIn', async () => {
    server.use(
      http.post('/api/auth/password-reset/redeem', async ({ request }) => {
        expect(await request.json()).toEqual({ code: CODE, newPassword: 'brand new passphrase' })
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user } = renderWithProviders(<ResetPasswordScreen initialCode={CODE} />)

    await user.type(screen.getByLabelText(/^new password/i), 'brand new passphrase')
    await user.type(screen.getByLabelText(/^confirm password/i), 'brand new passphrase')
    await user.click(screen.getByRole('button', { name: 'Set new password' }))

    expect(await screen.findByText('Password changed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shouldReadEveryMissTheSameWay', async () => {
    server.use(
      http.post('/api/auth/password-reset/redeem', () =>
        HttpResponse.json({ code: 'INVALID_CODE' }, { status: 404 }),
      ),
    )
    const { user } = renderWithProviders(<ResetPasswordScreen initialCode={CODE} />)

    await user.type(screen.getByLabelText(/^new password/i), 'brand new passphrase')
    await user.type(screen.getByLabelText(/^confirm password/i), 'brand new passphrase')
    await user.click(screen.getByRole('button', { name: 'Set new password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "That reset code isn't valid anymore",
    )
  })
})
