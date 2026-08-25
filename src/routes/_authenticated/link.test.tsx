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

// The session cookies are missing or spent: the server answers 401 at the transport, exactly as
// it does for any other unauthenticated GraphQL request.
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
    // The regression a session-state guard would cause: a hard reload leaves AuthProvider's
    // in-memory session null while the real credentials sit in httpOnly cookies the page cannot
    // read. Nothing here signs in, so only the server's answer can let the form through.
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

    // The page is up and the check is unanswered: a loading state, never the form.
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
    // The guard only covers arrival. A session that dies while the code is being typed is the
    // lookup's 401 to answer, and it must still carry the typed code back.
    serverKnowsTheVisitor()
    server.use(
      http.post('/api/auth/device/authorizations/lookup', () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
    )
    const { router, user } = renderAppAt('/link')

    // Frame 13: lookup fires on the final character.
    await user.type(await screen.findByLabelText(/pairing code/i), 'bcdf-ghjk')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toEqual({ redirect: '/link?code=BCDFGHJK' })
  })
})
