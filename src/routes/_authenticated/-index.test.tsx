import { screen } from '@testing-library/react'
import { HttpResponse, graphql, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { meFixture } from '../../test/meFixture'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'

describe('/', () => {
  it('shouldOfferRetryWhenCsrfRetryCannotLoadTheSession', async () => {
    const rejectCsrf = () => HttpResponse.json({ code: 'CSRF_TOKEN_REQUIRED' }, { status: 403 })
    server.use(
      // The probe and the error link's one CSRF retry.
      http.post('/graphql', rejectCsrf, { once: true }),
      http.post('/graphql', rejectCsrf, { once: true }),
      graphql.query('Me', () =>
        HttpResponse.json({ data: { me: meFixture({ scope: 'profile' }) } }),
      ),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('Home', () =>
        HttpResponse.json({ data: { continueWatching: [], libraries: [] } }),
      ),
    )
    const { user } = renderAppAt('/')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Your session security check failed.')
    expect(alert).not.toHaveTextContent(/reload/i)
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('banner')).toBeInTheDocument()
    expect(screen.queryByText('Your session security check failed.')).not.toBeInTheDocument()
  })
})
