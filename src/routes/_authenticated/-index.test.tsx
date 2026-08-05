import { screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'

describe('/', () => {
  it('shouldExplainRecoveryWhenCsrfRetryCannotLoadTheSession', async () => {
    server.use(
      http.post('/graphql', () =>
        HttpResponse.json({ code: 'CSRF_TOKEN_REQUIRED' }, { status: 403 }),
      ),
    )

    renderAppAt('/')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /reload the page and try again/i,
    )
  })
})
