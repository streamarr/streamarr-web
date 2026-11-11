import { act, screen, waitFor } from '@testing-library/react'
import { graphql, http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type {
  LookUpShareCodeMutation,
  LookUpShareCodeMutationVariables,
} from '../../graphql/generated/graphql'
import { shareCodeLink } from '../../identity/shareCode'
import { meFixture, profileFixture } from '../../test/meFixture'
import { renderAppAt } from '../../test/render'
import { menuCountReads, server } from '../../test/server'
import {
  SENT_SHARE_CODE,
  serveShareCodeQuestions,
  SHARE_CODE,
  shareCodeLookUpFixture,
} from '../../test/shareCodeFixtures'
import { signIn } from '../../test/signIn'

const SHARING = '/settings/profile/sharing'
const LINK = new URL(shareCodeLink(SHARE_CODE, 'https://streamarr.test'))
const ARRIVAL = `${LINK.pathname}${LINK.search}${LINK.hash}`
const SECOND_SHARE_CODE = 'LMNP-QRST'
const SECOND_SENT_CODE = 'LMNPQRST'

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
    ...menuCountReads,
  )
  return serveShareCodeQuestions()
}

/** Answers the lookup of each code with the name of the Household that the code belongs to. */
function serveLookUpsNaming(households: Record<string, string>) {
  server.use(
    graphql.mutation<LookUpShareCodeMutation, LookUpShareCodeMutationVariables>(
      'LookUpShareCode',
      ({ variables }) =>
        HttpResponse.json({
          data: shareCodeLookUpFixture({ householdName: households[variables.input.code] }),
        }),
    ),
  )
}

describe('/settings/profile/sharing', () => {
  it('shouldCarryTheCodeInTheAddressFragmentWhenALinkIsMade', () => {
    expect(LINK.pathname).toBe(SHARING)
    expect(LINK.search).toBe('')
    expect(LINK.hash).toBe(`#code=${SHARE_CODE}`)
  })

  it('shouldReviewTheOfferOfALinksCodeAndTakeTheCodeOutOfTheAddressWhenASignedInPersonArrives', async () => {
    const asked = serveSharing()
    const { router } = renderAppAt(ARRIVAL)

    const question = await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })
    // The review takes focus once it has rendered, which a loaded machine can show a moment apart.
    await waitFor(() => expect(question).toHaveFocus())
    expect(asked.lookUps).toEqual([{ input: { code: SENT_SHARE_CODE } }])
    // Taken out through the router, so the history entry keeps its index and key.
    await waitFor(() => expect(router.state.location.hash).toBe(''))
    expect(router.state.location.pathname).toBe(SHARING)
    expect(router.state.location.searchStr).toBe('')
    expect(typeof router.state.location.state.__TSR_index).toBe('number')
    expect(router.history.length).toBe(1)
  })

  it('shouldReviewTheOfferOfALinksCodeWhenTheLinkOpensWhileTheSharingPageIsOpen', async () => {
    const asked = serveSharing()
    const { router } = renderAppAt(SHARING)
    await screen.findByRole('button', { name: 'Share with another Household' })

    // Pasted into the address bar of the open page, the link changes only the fragment, so the
    // browser keeps the page and adds a history entry.
    act(() => router.history.push(ARRIVAL))

    expect(await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })).toHaveFocus()
    expect(asked.lookUps).toEqual([{ input: { code: SENT_SHARE_CODE } }])
    await waitFor(() => expect(router.state.location.hash).toBe(''))
  })

  it('shouldReviewTheOfferOfTheSecondLinksCodeWhenASecondLinkOpensOverTheReviewOfTheFirst', async () => {
    const asked = serveSharing()
    serveLookUpsNaming({ [SENT_SHARE_CODE]: 'Cabin', [SECOND_SENT_CODE]: 'Lake House' })
    const { router } = renderAppAt(ARRIVAL)
    await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })
    await waitFor(() => expect(router.state.location.hash).toBe(''))

    act(() => router.history.push(`${SHARING}#code=${SECOND_SHARE_CODE}`))

    expect(await screen.findByRole('heading', { name: 'Offer Alex to Lake House?' })).toHaveFocus()
    expect(screen.queryByRole('heading', { name: 'Offer Alex to Cabin?' })).not.toBeInTheDocument()
    expect(asked.previews).toEqual([
      expect.objectContaining({ shareCode: SENT_SHARE_CODE }),
      expect.objectContaining({ shareCode: SECOND_SENT_CODE }),
    ])
    await waitFor(() => expect(router.state.location.hash).toBe(''))
  })

  it('shouldReviewTheOfferAgainWhenThePersonOpensTheSameLinkAgainAfterCancellingTheForm', async () => {
    const asked = serveSharing()
    const { router, user } = renderAppAt(ARRIVAL)
    await user.click(await screen.findByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(router.state.location.hash).toBe(''))

    act(() => router.history.push(ARRIVAL))

    expect(await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })).toHaveFocus()
    expect(asked.lookUps).toEqual([
      { input: { code: SENT_SHARE_CODE } },
      { input: { code: SENT_SHARE_CODE } },
    ])
  })

  it('shouldLookNothingUpWhenThePersonReloadsThePageTheLinkOpened', async () => {
    const asked = serveSharing()
    const { router, unmount } = renderAppAt(ARRIVAL)
    await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })
    await waitFor(() => expect(router.state.location.hash).toBe(''))
    const reloaded = router.state.location.href
    unmount()

    renderAppAt(reloaded)

    expect(
      await screen.findByRole('button', { name: 'Share with another Household' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('textbox', { name: 'Share code from the other Household' }),
    ).not.toBeInTheDocument()
    expect(asked.lookUps).toHaveLength(1)
  })

  it('shouldLookALinksCodeUpOnceWhenThePersonOpensTheFormAgain', async () => {
    const asked = serveSharing()
    const { user } = renderAppAt(ARRIVAL)

    await user.click(await screen.findByRole('button', { name: 'Back' }))
    expect(
      screen.getByRole('textbox', { name: 'Share code from the other Household' }),
    ).toHaveValue(SHARE_CODE)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Share with another Household' }))

    expect(
      screen.getByRole('textbox', { name: 'Share code from the other Household' }),
    ).toHaveValue('')
    expect(asked.lookUps).toHaveLength(1)
  })

  it('shouldSayALinksCodeIsEightLettersWithoutAskingTheServerWhenItCannotBeOne', async () => {
    const asked = serveSharing()
    renderAppAt(`${SHARING}#code=hello`)

    const field = await screen.findByRole('textbox', {
      name: 'Share code from the other Household',
    })
    await waitFor(() => expect(field).toBeInvalid())
    expect(field).toHaveValue('hello')
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining('A share code is 8 letters, like BCDF-GHJK.'),
    )
    expect(asked.lookUps).toEqual([])
  })

  it('shouldCarryALinksCodeThroughSigningInWithoutPuttingItInAQueryStringWhenThePersonIsSignedOut', async () => {
    server.use(
      http.post('/graphql', () =>
        HttpResponse.json({ code: 'AUTHENTICATION_REQUIRED' }, { status: 401 }),
      ),
    )
    const { router, user } = renderAppAt(ARRIVAL)
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toEqual({ redirect: SHARING })
    expect(router.state.location.searchStr).not.toContain(SENT_SHARE_CODE)
    expect(router.state.location.hash).toBe(`code=${SHARE_CODE}`)

    const asked = serveSharing()
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ accessTokenExpiresAt: '2026-08-05T12:00:00Z', scope: 'account' }),
      ),
    )
    await signIn(user)

    expect(await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })).toBeVisible()
    expect(asked.lookUps).toEqual([{ input: { code: SENT_SHARE_CODE } }])
    await waitFor(() => expect(router.state.location.hash).toBe(''))
    expect(router.state.location.searchStr).toBe('')
    // The sign-in page and the arrival each took the place of the entry before them.
    expect(router.history.length).toBe(1)
  })
})
