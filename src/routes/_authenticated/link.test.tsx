import { screen, waitFor } from '@testing-library/react'
import { HttpResponse, graphql, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'
import { meFixture } from '../../test/meFixture'

const ME = meFixture({ scope: 'account' })

function serverKnowsTheVisitor() {
  server.use(graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })))
}

function serverRejectsTheVisitor() {
  server.use(
    http.post('/graphql', () =>
      HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
    ),
  )
}

const codeField = () => screen.queryByLabelText(/pairing code/i)

describe('/link', () => {
  it('shouldBounceToSignInWhenTheServerDoesNotKnowTheVisitor', async () => {
    serverRejectsTheVisitor()
    const { router } = renderAppAt('/link')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(codeField()).not.toBeInTheDocument()
  })

  it('shouldReturnToLinkAfterSigningIn', async () => {
    serverRejectsTheVisitor()
    const { router } = renderAppAt('/link')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toEqual({ redirect: '/link' })
  })

  it('shouldShowTheCodeFormWhenTheServerKnowsTheVisitor', async () => {
    // Nothing here signs in: only the server's answer can let the form through.
    serverKnowsTheVisitor()
    const { router } = renderAppAt('/link')

    expect(await screen.findByLabelText(/pairing code/i)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/link')
  })

  it('shouldNotShowTheCodeFormWhileTheCheckIsInFlight', async () => {
    let answer = () => {}
    const held = new Promise<void>((resolve) => {
      answer = resolve
    })
    server.use(
      graphql.query('Me', async () => {
        await held
        return HttpResponse.json({ data: { me: ME } })
      }),
    )
    renderAppAt('/link')

    expect(await screen.findByRole('status', { name: /checking your account/i })).toBeInTheDocument()
    expect(codeField()).not.toBeInTheDocument()

    answer()
    expect(await screen.findByLabelText(/pairing code/i)).toBeInTheDocument()
  })

  it('shouldNotShowTheCodeFormWhenTheCheckCannotBeAnswered', async () => {
    server.use(http.post('/graphql', () => HttpResponse.json({}, { status: 500 })))
    const { router } = renderAppAt('/link')

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(codeField()).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/link')
  })

  it('shouldPrefillTheCodeCarriedBackFromSigningInAndStripItFromTheUrl', async () => {
    serverKnowsTheVisitor()
    const { router } = renderAppAt('/link?code=BCDF-GHJK')

    expect(await screen.findByLabelText(/pairing code/i)).toHaveValue('BCDFGHJK')
    // Stripped through the router, so the history entry keeps its index and key.
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(router.state.location.pathname).toBe('/link')
    expect(typeof router.state.location.state.__TSR_index).toBe('number')
    expect(screen.getByLabelText(/pairing code/i)).toHaveValue('BCDFGHJK')
  })

  it('shouldStillBounceCarryingTheCodeWhenTheSessionExpiresAfterArriving', async () => {
    serverKnowsTheVisitor()
    server.use(
      http.post('/api/auth/device/authorizations/lookup', () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
    )
    const { router, user } = renderAppAt('/link')

    await user.type(await screen.findByLabelText(/pairing code/i), 'bcdf-ghjk')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toEqual({ redirect: '/link?code=BCDFGHJK' })
  })
})
