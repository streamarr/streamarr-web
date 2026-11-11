import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

const CODE = 'pub-1234.super-secret'

function serveLookUps() {
  const asked = { lookUps: 0 }
  server.use(
    http.post('/api/auth/invitation/lookup', () => {
      asked.lookUps += 1
      return HttpResponse.json(
        { code: 'INVALID_CODE', message: 'That code is not redeemable.' },
        { status: 404 },
      )
    }),
  )
  return asked
}

describe('/invite', () => {
  it('shouldTakeTheCodeFromTheFragmentAndOutOfTheAddressWhileKeepingItAsThePrefillWhenALinkArrives', async () => {
    const asked = serveLookUps()
    const { router } = renderAppAt(`/invite#code=${encodeURIComponent(CODE)}`)

    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not redeemable.')
    expect(screen.getByLabelText(/^invitation code/i)).toHaveValue(CODE)
    expect(asked.lookUps).toBe(1)

    await waitFor(() => expect(router.state.location.hash).toBe(''))
    expect(router.state.location.pathname).toBe('/invite')
    expect(router.state.location.searchStr).toBe('')
    // Taken out through the router, so the entry keeps the index later navigations build on.
    expect(typeof router.state.location.state.__TSR_index).toBe('number')
    expect(router.history.length).toBe(1)
  })

  it('shouldLookNothingUpWhenThePersonReloadsThePageTheLinkOpened', async () => {
    const asked = serveLookUps()
    const { router, unmount } = renderAppAt(`/invite#code=${encodeURIComponent(CODE)}`)
    await screen.findByRole('alert')
    await waitFor(() => expect(router.state.location.hash).toBe(''))
    const reloaded = router.state.location.href
    unmount()

    renderAppAt(reloaded)

    expect(await screen.findByLabelText(/^invitation code/i)).toHaveValue('')
    expect(asked.lookUps).toBe(1)
  })
})
