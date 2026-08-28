import { screen } from '@testing-library/react'
import { http, HttpResponse, type JsonBodyType } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { ResetPasswordScreen } from './ResetPasswordScreen'

const CODE = 'reset-1234.super-secret'

function redeemAnswers(body: JsonBodyType, init: ResponseInit) {
  server.use(
    http.post('/api/auth/password-reset/redeem', () => HttpResponse.json(body, init)),
  )
}

async function submitNewPassword(
  user: ReturnType<typeof import('@testing-library/user-event').default.setup>,
) {
  await user.type(screen.getByLabelText(/^new password/i), 'brand new passphrase')
  await user.type(screen.getByLabelText(/^confirm password/i), 'brand new passphrase')
  await user.click(screen.getByRole('button', { name: 'Set new password' }))
}

describe('ResetPasswordScreen', () => {
  it('shouldChangeThePasswordAndPointAtSignIn', async () => {
    server.use(
      http.post('/api/auth/password-reset/redeem', async ({ request }) => {
        expect(await request.json()).toEqual({ code: CODE, newPassword: 'brand new passphrase' })
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user } = renderWithProviders(<ResetPasswordScreen initialCode={CODE} />)

    await submitNewPassword(user)

    expect(await screen.findByText('Password changed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shouldReadEveryMissTheSameWay', async () => {
    redeemAnswers(
      { code: 'INVALID_CODE', message: 'That code is not redeemable.' },
      { status: 404 },
    )
    const { user } = renderWithProviders(<ResetPasswordScreen initialCode={CODE} />)

    await submitNewPassword(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not redeemable.')
  })

  it('shouldShowTheServersThrottleSentenceOnTooManyAttempts', async () => {
    redeemAnswers(
      {
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many failed credential attempts. Try again later.',
      },
      { status: 429 },
    )
    const { user } = renderWithProviders(<ResetPasswordScreen initialCode={CODE} />)

    await submitNewPassword(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many failed credential attempts. Try again later.',
    )
  })

  it('shouldSayHowLongToWaitWhenTheThrottleCarriesRetryAfter', async () => {
    redeemAnswers(
      {
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many failed credential attempts. Try again later.',
      },
      { status: 429, headers: { 'Retry-After': '30' } },
    )
    const { user } = renderWithProviders(<ResetPasswordScreen initialCode={CODE} />)

    await submitNewPassword(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again in 30 seconds.',
    )
  })

  it('shouldExplainThatThePasswordCannotBeUsedWhenValidationRefusesIt', async () => {
    redeemAnswers({ errors: [{ field: 'newPassword' }] }, { status: 400 })
    const { user } = renderWithProviders(<ResetPasswordScreen initialCode={CODE} />)

    await submitNewPassword(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That password cannot be used. Choose a different one.',
    )
  })

  it('shouldFallBackToAGenericSentenceWhenTheServerSaysNothing', async () => {
    redeemAnswers({}, { status: 503 })
    const { user } = renderWithProviders(<ResetPasswordScreen initialCode={CODE} />)

    await submitNewPassword(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
  })
})
