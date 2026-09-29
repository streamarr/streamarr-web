import { screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'

describe('/', () => {
  it('shouldOfferRetryWhenCsrfRetryCannotLoadTheSession', async () => {
    server.use(
      http.post('/graphql', () =>
        HttpResponse.json({ code: 'CSRF_TOKEN_REQUIRED' }, { status: 403 }),
      ),
    )

    renderAppAt('/')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Your session security check failed.')
    expect(alert).not.toHaveTextContent(/reload/i)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})
