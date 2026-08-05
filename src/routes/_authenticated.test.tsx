import { screen, waitFor } from '@testing-library/react'
import { HttpResponse, graphql, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

const ME = {
  accountId: '11111111-1111-1111-1111-111111111111',
  email: 'owner@example.com',
  displayName: 'Owner',
  role: 'ADMIN',
  scope: 'profile',
  memberships: [],
}

describe('the authenticated layout', () => {
  it('shouldShowOnlyTheCheckWhileTheServerHasNotAnswered', async () => {
    // While the answer is pending nothing but the check may show — not the page, whose own
    // loading states only exist for visitors already past the gate.
    let answer = () => {}
    const held = new Promise<void>((resolve) => {
      answer = resolve
    })
    server.use(
      http.post('/graphql', async () => {
        await held
        return HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 })
      }),
    )
    const { router } = renderAppAt('/')

    expect(
      await screen.findByRole('status', { name: /checking your account/i }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/welcome/i)).not.toBeInTheDocument()

    answer()
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('shouldBounceAnAnonymousVisitorToSignIn', async () => {
    server.use(
      http.post('/graphql', () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
    )
    const { router } = renderAppAt('/')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    // The bounce records where the visitor was headed so signing in can resume it.
    expect(router.state.location.search).toEqual({ redirect: '/' })
  })

  it('shouldRenderTheGuardedPageForASignedInVisitor', async () => {
    server.use(graphql.query('Me', () => HttpResponse.json({ data: { me: ME } })))
    const { router } = renderAppAt('/')

    expect(await screen.findByText(/welcome, owner/i)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('shouldLeaveSignInReachableWithoutAskingTheServer', async () => {
    // No MSW handlers at all: if the gate probed the server from /login, the unhandled request
    // would fail this test loudly.
    const { router } = renderAppAt('/login')

    expect(await screen.findByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('shouldFailClosedWithAnAlertWhenTheServerCannotAnswer', async () => {
    // An outage is not a verdict: neither the page nor a misleading bounce to sign-in — the
    // visitor may well be signed in. Say so and let them retry.
    server.use(http.post('/graphql', () => HttpResponse.json({}, { status: 500 })))
    const { router } = renderAppAt('/')

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't confirm/i)
    expect(router.state.location.pathname).toBe('/')
    expect(screen.queryByText(/welcome/i)).not.toBeInTheDocument()
  })
})
