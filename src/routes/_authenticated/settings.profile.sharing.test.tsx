import { screen, waitFor } from '@testing-library/react'
import { graphql, http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { shareCodeLink } from '../../identity/shareCode'
import { meFixture, profileFixture } from '../../test/meFixture'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'
import { SENT_SHARE_CODE, serveShareCodeQuestions, SHARE_CODE } from '../../test/shareCodeFixtures'
import { signIn } from '../../test/signIn'

const LINK = new URL(shareCodeLink(SHARE_CODE, 'https://streamarr.test'))
const ARRIVAL = `${LINK.pathname}${LINK.search}`

// An account session with no selected Profile: a link can arrive before anyone picks one.
function serveSharing() {
  server.use(
    graphql.query('Me', () =>
      HttpResponse.json({ data: { me: meFixture({ profiles: [profileFixture()] }) } }),
    ),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('ProfileShares', () =>
      HttpResponse.json({
        data: { profileShares: { __typename: 'ProfileShareConnection', edges: [] } },
      }),
    ),
  )
  return serveShareCodeQuestions()
}

describe('/settings/profile/sharing', () => {
  it('shouldReviewTheOfferOfALinksCodeAndTakeTheCodeOutOfTheAddress', async () => {
    const asked = serveSharing()
    const { router } = renderAppAt(ARRIVAL)

    const question = await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })
    expect(question).toHaveFocus()
    expect(asked.lookUps).toEqual([{ input: { code: SENT_SHARE_CODE } }])
    // Taken out through the router, so the history entry keeps its index and key.
    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(router.state.location.pathname).toBe('/settings/profile/sharing')
    expect(typeof router.state.location.state.__TSR_index).toBe('number')
  })

  it('shouldLookALinksCodeUpOnceWhenThePersonOpensTheFormAgain', async () => {
    const asked = serveSharing()
    const { user } = renderAppAt(ARRIVAL)

    await user.click(await screen.findByRole('button', { name: 'Back' }))
    expect(screen.getByRole('textbox', { name: 'Share code' })).toHaveValue(SHARE_CODE)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Share with another Household' }))

    expect(screen.getByRole('textbox', { name: 'Share code' })).toHaveValue('')
    expect(asked.lookUps).toHaveLength(1)
  })

  it('shouldSayALinksCodeIsEightLettersWithoutAskingTheServerWhenItCannotBeOne', async () => {
    const asked = serveSharing()
    renderAppAt('/settings/profile/sharing?code=hello')

    const field = await screen.findByRole('textbox', { name: 'Share code' })
    await waitFor(() => expect(field).toBeInvalid())
    expect(field).toHaveValue('hello')
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining('A share code is 8 letters, like BCDF-GHJK.'),
    )
    expect(asked.lookUps).toEqual([])
  })

  it('shouldCarryALinksCodeThroughSigningIn', async () => {
    server.use(
      http.post('/graphql', () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
    )
    const { router, user } = renderAppAt(ARRIVAL)
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toEqual({ redirect: ARRIVAL })

    serveSharing()
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ accessTokenExpiresAt: '2026-08-05T12:00:00Z', scope: 'account' }),
      ),
    )
    await signIn(user)

    expect(await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })).toBeVisible()
    await waitFor(() => expect(router.state.location.search).toEqual({}))
  })
})
