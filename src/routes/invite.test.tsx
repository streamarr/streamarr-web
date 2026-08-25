import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

const CODE = 'pub-1234.super-secret'

describe('/invite', () => {
  it('shouldStripTheCodeFromTheAddressWhileKeepingItAsThePrefill', async () => {
    // An invitation code is a bearer capability that creates an account: it must not stay in
    // the address bar or the history entry, but the person must not have to paste it again.
    let lookups = 0
    server.use(
      http.post('/api/auth/invitation/lookup', () => {
        lookups += 1
        return HttpResponse.json(
          { code: 'INVALID_CODE', message: 'That code is not redeemable.' },
          { status: 404 },
        )
      }),
    )
    const { router } = renderAppAt(`/invite?code=${encodeURIComponent(CODE)}`)

    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not redeemable.')
    expect(screen.getByLabelText(/^invitation code/i)).toHaveValue(CODE)
    expect(lookups).toBe(1)

    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(router.state.location.pathname).toBe('/invite')
    // Stripped through the router, so the entry keeps the index later navigations build on.
    expect(typeof router.state.location.state.__TSR_index).toBe('number')
  })
})
