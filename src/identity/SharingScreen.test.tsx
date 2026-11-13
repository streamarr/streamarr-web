import { screen, waitFor, within } from '@testing-library/react'
import { delay, graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { ProfileSharesQuery } from '../graphql/generated/graphql'
import {
  answersInTurn,
  answersThenHolds,
  answerWith,
  comeBackOnline,
  comeBackOnlineUntil,
  failsOnceThen,
  heldAnswer,
  networkFailure,
  refusedWith,
  serverFailure,
} from '../test/graphqlResponses'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { profileLanguagesFixture } from '../test/languageFixtures'
import { HOUSEHOLD_ID, meFixture, PROFILE_ID, profileFixture } from '../test/meFixture'
import { renderAppAt, renderWithProviders } from '../test/render'
import { leaveForHome, returnThroughTheProfileMenu, type SettingsPage } from '../test/returnVisits'
import { server } from '../test/server'
import {
  refusedShareCodeFixture,
  SENT_SHARE_CODE,
  serveShareCodeQuestions,
  SHARE_CODE,
  shareCodeLookUpFixture,
  sharePreviewFixture,
} from '../test/shareCodeFixtures'
import { SharingScreen } from './SharingScreen'

type ShareNode = ProfileSharesQuery['profileShares']['edges'][number]['node'] & {
  __typename: 'ProfileShare'
}

const SHARING = '/settings/profile/sharing'
const SHARING_PAGE: SettingsPage = {
  area: 'Profile settings',
  section: 'Sharing',
  heading: 'Sharing',
}
const SHARE_ID = '77777777-7777-7777-7777-777777777777'
const CABIN_ID = '55555555-5555-5555-5555-555555555555'
const LAKE_HOUSE_ID = '66666666-6666-6666-6666-666666666666'
const SMITH_FAMILY = { id: HOUSEHOLD_ID, name: 'Smith Family', membership: true }
const CABIN = { id: CABIN_ID, name: 'Cabin', membership: false }
const DAY = 24 * 60 * 60 * 1000

function share(overrides: Partial<ShareNode> = {}): ShareNode {
  return {
    __typename: 'ProfileShare',
    id: SHARE_ID,
    householdId: CABIN_ID,
    status: 'PENDING',
    requiredByAccountMembership: false,
    expiresAt: null,
    endedAt: null,
    invalidationReason: null,
    ...overrides,
  }
}

// The share that every Personal Profile has into its Account's own Household.
function membershipShare(): ShareNode {
  return share({
    id: '88888888-8888-8888-8888-888888888888',
    householdId: HOUSEHOLD_ID,
    status: 'ACTIVE',
    requiredByAccountMembership: true,
  })
}

function sharesData(shares: ShareNode[] = []) {
  return {
    profileShares: {
      __typename: 'ProfileShareConnection',
      edges: shares.map((node) => ({ __typename: 'ProfileShareEdge', node })),
    },
  }
}

function me(usableHouseholds = [SMITH_FAMILY]) {
  return meFixture({ profiles: [profileFixture()], usableHouseholds })
}

function serve(shares: ShareNode[] = [], account = me()) {
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: account } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('ProfileShares', ({ variables }) => {
      expect(variables).toEqual({ profileId: PROFILE_ID })
      return HttpResponse.json({ data: sharesData(shares) })
    }),
  )
  serveShareCodeQuestions()
}

// Answers each read of the shares with the next list, and the last list from then on.
function serveInTurn(...lists: ShareNode[][]) {
  serve([], me([SMITH_FAMILY, CABIN]))
  const handler = answersInTurn(...lists.map((shares) => answerWith(sharesData(shares))))
  server.use(graphql.query('ProfileShares', handler.resolver))
  return handler
}

// Answers the first read of the shares with `shares` and fails each read after it.
function serveOneReadThenFail(shares: ShareNode[]) {
  serve([], me([SMITH_FAMILY, CABIN]))
  const handler = answersInTurn(answerWith(sharesData(shares)), serverFailure)
  server.use(graphql.query('ProfileShares', handler.resolver))
}

// Answers the first read of the shares with `shares` and fails the second. Each read after it
// answers with `afterFailure`, the shares as they stand by then, which are `shares` unless given.
function serveSecondReadFailing(
  shares: ShareNode[],
  { afterFailure = shares }: { afterFailure?: ShareNode[] } = {},
) {
  serve([], me([SMITH_FAMILY, CABIN]))
  const handler = answersInTurn(
    answerWith(sharesData(shares)),
    serverFailure,
    answerWith(sharesData(afterFailure)),
  )
  server.use(graphql.query('ProfileShares', handler.resolver))
}

// A return goes through the Profile menu, which offers Profile settings only with a Profile
// selected, and through Languages, where Profile settings open. A selected Profile also opens the
// socket of live changes.
function serveReturnVisits(shares: ShareNode[]) {
  const account = meFixture({
    scope: 'profile',
    profiles: [profileFixture({ selected: true })],
    usableHouseholds: [SMITH_FAMILY, CABIN],
  })
  serve(shares, account)
  serveGraphqlSocket()
  server.use(
    graphql.query('LanguageSettings', () =>
      HttpResponse.json({
        data: { me: { __typename: 'Me', languagePreferences: profileLanguagesFixture() } },
      }),
    ),
  )
}

function offered() {
  return {
    offerProfileShare: {
      __typename: 'OfferProfileSharePayload',
      share: { __typename: 'ProfileShare', id: SHARE_ID, status: 'PENDING' },
      userErrors: [],
    },
  }
}

async function openShareForm(user: ReturnType<typeof renderWithProviders>['user']) {
  await user.click(await screen.findByRole('button', { name: 'Share with another Household' }))
  return screen.getByRole('textbox', { name: 'Share code' })
}

describe('Sharing', () => {
  it('shouldShowSharingAsASectionOfProfileSettingsWhenItsAddressOpens', async () => {
    serve()
    renderAppAt(SHARING)

    const menu = await screen.findByRole('navigation', { name: 'Profile settings' })
    expect(within(menu).getByRole('link', { name: 'Sharing' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(menu).getByRole('link', { name: 'Languages' })).not.toHaveAttribute(
      'aria-current',
    )
    expect(
      await within(screen.getByRole('region', { name: 'Sharing' })).findByRole('heading', {
        level: 1,
        name: 'Sharing',
      }),
    ).toBeVisible()
  })

  it('shouldSayTheProfileIsSharedNowhereElseAndOfferToShareIt', async () => {
    serve([membershipShare()])
    renderWithProviders(<SharingScreen />)

    const shared = await screen.findByRole('region', { name: "Where Alex's Profile is shared" })
    expect(
      within(shared).getByText("Alex's Profile isn't shared with another Household."),
    ).toBeVisible()
    expect(within(shared).queryByRole('listitem')).not.toBeInTheDocument()
    expect(within(shared).queryByText('Smith Family')).not.toBeInTheDocument()
    expect(
      within(shared).getByRole('button', { name: 'Share with another Household' }),
    ).toBeEnabled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /invitations/i })).not.toBeInTheDocument()
  })

  it('shouldNameTheHouseholdOfAnActiveShareWhenTheAccountMayUseIt', async () => {
    serve([membershipShare(), share({ status: 'ACTIVE' })], me([SMITH_FAMILY, CABIN]))
    renderWithProviders(<SharingScreen />)

    const row = await screen.findByRole('listitem')
    expect(row).toHaveTextContent('Cabin')
    expect(within(row).getByRole('button', { name: 'End share with Cabin' })).toBeEnabled()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('shouldShowAnOfferAsWaitingWithTheTimeItHasLeft', async () => {
    const inSixDays = new Date(Date.now() + 6 * DAY + DAY / 24).toISOString()
    serve([share({ expiresAt: inSixDays })])
    renderWithProviders(<SharingScreen />)

    const row = await screen.findByRole('listitem')
    expect(row).toHaveTextContent('Household 55555555')
    expect(within(row).getByText('Waiting for an admin there')).toBeVisible()
    expect(within(row).getByText('Expires in 6 days')).toBeVisible()
    expect(
      within(row).getByRole('button', { name: 'Cancel invitation to Household 55555555' }),
    ).toBeEnabled()
  })

  it('shouldKeepEarlierOffersAndSharesOutOfTheListUntilAsked', async () => {
    serve([
      share({ id: 'a', status: 'REJECTED' }),
      share({ id: 'b', status: 'EXPIRED' }),
      share({ id: 'c', status: 'CANCELED' }),
      share({ id: 'd', status: 'ENDED', endedAt: '2026-08-20T12:00:00Z' }),
      share({ id: 'e', status: 'INVALIDATED', invalidationReason: 'Its offerer left.' }),
    ])
    const { user } = renderWithProviders(<SharingScreen />)

    const earlier = await screen.findByRole('button', { name: 'Earlier invitations and shares' })
    expect(earlier).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    expect(screen.getByText("Alex's Profile isn't shared with another Household.")).toBeVisible()

    await user.click(earlier)

    expect(earlier).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'Household 55555555Declined',
      'Household 55555555Expired',
      'Household 55555555Canceled',
      'Household 55555555Ended Aug 20, 2026',
      'Household 55555555Withdrawn: Its offerer left.',
    ])
    expect(screen.queryByRole('button', { name: /^End share|^Cancel invitation/ })).toBeNull()
  })

  it('shouldCancelAPendingOfferAndSaySo', async () => {
    const shares = serveInTurn([share()], [])
    let canceled = false
    server.use(
      graphql.mutation('CancelProfileShare', ({ variables }) => {
        expect(variables).toEqual({ input: { shareId: SHARE_ID } })
        canceled = true
        return HttpResponse.json({ data: { cancelProfileShare: canceledPayload() } })
      }),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' }))

    await noticed('Invitation to Cabin canceled.')
    expect(canceled).toBe(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(shares.calls).toBe(2))
  })

  it('shouldMoveFocusToTheHeadingWhenTheCanceledOffersButtonLeavesThePage', async () => {
    serveInTurn([share()], [])
    agreeToCancel()
    const { user } = renderWithProviders(<SharingScreen />)

    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' }))

    await noticed('Invitation to Cabin canceled.')
    expect(
      screen.queryByRole('button', { name: 'Cancel invitation to Cabin' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Sharing' })).toHaveFocus()
  })

  it('shouldEmptyTheStatusAndKeepItInThePageWhenThePersonDismissesTheNotice', async () => {
    serveInTurn([share()], [])
    agreeToCancel()
    const { user } = renderWithProviders(<SharingScreen />)
    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' }))
    await noticed('Invitation to Cabin canceled.')

    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))

    // The next notice then changes the text of a status already in the page, so it is read.
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('shouldMoveFocusToTheHeadingWhenThePersonDismissesTheNoticeFromTheKeyboard', async () => {
    serveInTurn([share()], [])
    agreeToCancel()
    const { user } = renderWithProviders(<SharingScreen />)
    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' }))
    await noticed('Invitation to Cabin canceled.')
    await user.tab()
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(screen.queryByRole('button', { name: 'Dismiss notification' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Sharing' })).toHaveFocus()
  })

  it('shouldLeaveFocusOnTheBodyWhenThePageOpensWithoutANotice', async () => {
    serve([share()])
    renderWithProviders(<SharingScreen />)

    expect(await screen.findByRole('button', { name: /^Cancel invitation to/ })).toBeEnabled()
    expect(document.body).toHaveFocus()
  })

  it('shouldKeepFocusInTheShareFormWhenACancelFinishesWhileThePersonTypes', async () => {
    serveInTurn([share()], [])
    const cancel = heldAnswer({ cancelProfileShare: canceledPayload() })
    server.use(graphql.mutation('CancelProfileShare', cancel.answer))
    const { user } = renderWithProviders(<SharingScreen />)
    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' }))
    const field = await openShareForm(user)
    await user.type(field, 'abc')
    expect(field).toHaveFocus()

    cancel.release()

    await noticed('Invitation to Cabin canceled.')
    expect(field).toHaveFocus()
  })

  it('shouldSayTheCancelInAStatusAlreadyInThePageWhenFocusStaysInTheShareForm', async () => {
    serveInTurn([share()], [])
    const cancel = heldAnswer({ cancelProfileShare: canceledPayload() })
    server.use(graphql.mutation('CancelProfileShare', cancel.answer))
    const { user } = renderWithProviders(<SharingScreen />)
    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' }))
    await user.type(await openShareForm(user), 'abc')
    // A screen reader reads a status whose text changes, not one added to the page with its text.
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()

    cancel.release()

    await waitFor(() => expect(status).toHaveTextContent(/^Invitation to Cabin canceled\.$/))
  })

  it('shouldShowTheServersWordsAndReadTheSharesAgainWhenCancelingIsRefused', async () => {
    const shares = serveInTurn([share()], [share()])
    refuseToCancel()
    const { user } = renderWithProviders(<SharingScreen />)

    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That offer is not pending.')
    await waitFor(() => expect(shares.calls).toBe(2))
  })

  it('shouldNotSayTheOfferWasCanceledWhenCancelingIsRefused', async () => {
    serveInTurn([share()])
    refuseToCancel()
    const { user } = renderWithProviders(<SharingScreen />)

    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' }))

    await screen.findByRole('alert')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel invitation to Cabin' })).toBeEnabled(),
    )
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('shouldSayTheOfferWasCanceledWhenReadingTheSharesAgainFails', async () => {
    serveOneReadThenFail([share()])
    server.use(
      graphql.mutation('CancelProfileShare', () =>
        HttpResponse.json({ data: { cancelProfileShare: canceledPayload() } }),
      ),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' }))

    await noticed('Invitation to Cabin canceled.')
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load sharing.")
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Cancel invitation to Cabin' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Sharing' })).toHaveFocus()
  })

  it('shouldShowTheServersWordsAgainWhenRetryBringsTheSharesBackAfterARefusedCancel', async () => {
    serveSecondReadFailing([share()])
    refuseToCancel()
    const { user } = renderWithProviders(<SharingScreen />)

    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' }))
    expect(await screen.findByText("Couldn't load sharing.")).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('That offer is not pending.')
  })

  it('shouldTakeTheServersWordsAwayWhenTheNextCancelIsTaken', async () => {
    serveInTurn([share()], [share()], [])
    refuseToCancel()
    const { user } = renderWithProviders(<SharingScreen />)
    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That offer is not pending.')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel invitation to Cabin' })).toBeEnabled(),
    )

    server.use(
      graphql.mutation('CancelProfileShare', () =>
        HttpResponse.json({ data: { cancelProfileShare: canceledPayload() } }),
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Cancel invitation to Cabin' }))

    await noticed('Invitation to Cabin canceled.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldTakeTheServersWordsAwayWhenThePersonSendsANewShare', async () => {
    serveInTurn([share()], [], [share()])
    refuseToCancel()
    server.use(graphql.mutation('OfferProfileShare', () => HttpResponse.json({ data: offered() })))
    const { user } = renderWithProviders(<SharingScreen />)
    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That offer is not pending.')

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))

    await noticed('Invitation sent to Cabin. An admin there must accept it.')
    expect(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldTakeTheServersWordsAwayWhenThePersonSendsANewShareAfterRetryBroughtThemBack', async () => {
    serve([], me([SMITH_FAMILY, CABIN]))
    const shares = answersInTurn(
      answerWith(sharesData([share()])),
      serverFailure,
      answerWith(sharesData([])),
      answerWith(sharesData([share()])),
    )
    server.use(graphql.query('ProfileShares', shares.resolver))
    refuseToCancel()
    server.use(graphql.mutation('OfferProfileShare', () => HttpResponse.json({ data: offered() })))
    const { user } = renderWithProviders(<SharingScreen />)
    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' }))
    expect(await screen.findByText("Couldn't load sharing.")).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByText("Alex's Profile isn't shared with another Household."),
    ).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('That offer is not pending.')

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))

    await noticed('Invitation sent to Cabin. An admin there must accept it.')
    expect(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldKeepTheServersWordsWhileThePersonFillsInANewShareUntilTheySendIt', async () => {
    serveInTurn([share()], [], [share()])
    refuseToCancel()
    const offer = heldAnswer(offered())
    server.use(graphql.mutation('OfferProfileShare', offer.answer))
    const { user } = renderWithProviders(<SharingScreen />)
    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That offer is not pending.')

    const field = await openShareForm(user)
    expect(screen.getByRole('alert')).toHaveTextContent('That offer is not pending.')
    await user.type(field, `${SHARE_CODE}{Enter}`)
    await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })
    expect(screen.getByRole('alert')).toHaveTextContent('That offer is not pending.')

    await user.click(screen.getByRole('button', { name: 'Send invitation' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    offer.release()
    await noticed('Invitation sent to Cabin. An admin there must accept it.')
  })

  it('shouldKeepTheServersWordsWhenTheTextThePersonContinuesWithCannotBeACode', async () => {
    serveInTurn([share()])
    refuseToCancel()
    const { user } = renderWithProviders(<SharingScreen />)
    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That offer is not pending.')
    const field = await openShareForm(user)
    await user.type(field, 'the Smiths')

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(field).toHaveAccessibleDescription(
      expect.stringContaining('A share code is 8 letters, like BCDF-GHJK.'),
    )
    expect(screen.getByRole('alert')).toHaveTextContent('That offer is not pending.')
  })

  it('shouldStartNoOtherChangeUntilACancelOnItsWayLandsWhenRetryBringsTheSharesBack', async () => {
    const elsewhere = share({ id: 'elsewhere', householdId: LAKE_HOUSE_ID, status: 'ACTIVE' })
    serveSecondReadFailing([share(), elsewhere])
    const refusal = heldAnswer({ cancelProfileShare: notPendingPayload() })
    server.use(
      graphql.mutation('CancelProfileShare', refusal.answer),
      graphql.mutation('OfferProfileShare', () => HttpResponse.json({ data: offered() })),
    )
    const { user } = renderWithProviders(<SharingScreen />)
    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' }))
    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText("Couldn't load sharing.")).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    const endElsewhere = await screen.findByRole('button', {
      name: 'End share with Household 66666666',
    })
    expect(endElsewhere).toBeDisabled()
    refusal.release()
    expect(await screen.findByRole('alert')).toHaveTextContent('That offer is not pending.')
    await waitFor(() => expect(endElsewhere).toBeEnabled())
  })

  it('shouldOpenTheConfirmationWithoutAnEarlierRefusalWhenThePersonAsksToEndAShare', async () => {
    const elsewhere = share({ id: 'elsewhere', householdId: LAKE_HOUSE_ID, status: 'ACTIVE' })
    serveInTurn([share(), elsewhere])
    refuseToCancel()
    const { user } = renderWithProviders(<SharingScreen />)
    await user.click(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That offer is not pending.')
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'End share with Household 66666666' }),
      ).toBeEnabled(),
    )

    await user.click(screen.getByRole('button', { name: 'End share with Household 66666666' }))

    expect(
      screen.getByRole('dialog', { name: 'End sharing with Household 66666666?' }),
    ).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldSayWhatEndsBeforeItEndsAShare', async () => {
    serveInTurn([share({ status: 'ACTIVE' })])
    let ended = false
    server.use(
      graphql.mutation('EndProfileShare', () => {
        ended = true
        return HttpResponse.json({ data: { endProfileShare: endedPayload() } })
      }),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    await user.click(await screen.findByRole('button', { name: 'End share with Cabin' }))

    const dialog = screen.getByRole('dialog', { name: 'End sharing with Cabin?' })
    expect(dialog).toHaveTextContent(
      "Alex's Profile stops being available in Cabin. The TVs you linked there are unlinked, and your sessions there return to Smith Family. To share Alex's Profile with Cabin again, send a new invitation. An admin there must accept it.",
    )
    expect(ended).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(ended).toBe(false)
  })

  it('shouldEndTheShareAndSaySoWhenThePersonConfirms', async () => {
    const shares = serveInTurn([share({ status: 'ACTIVE' })], [])
    server.use(
      graphql.mutation('EndProfileShare', ({ variables }) => {
        expect(variables).toEqual({ input: { shareId: SHARE_ID } })
        return HttpResponse.json({ data: { endProfileShare: endedPayload() } })
      }),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    await user.click(await screen.findByRole('button', { name: 'End share with Cabin' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End share' }))

    await noticed('Sharing with Cabin ended.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(shares.calls).toBe(2)
    expect(screen.getByRole('heading', { level: 1, name: 'Sharing' })).toHaveFocus()
  })

  it('shouldSayTheShareEndedWhenReadingTheSharesAgainFails', async () => {
    serveOneReadThenFail([share({ status: 'ACTIVE' })])
    server.use(
      graphql.mutation('EndProfileShare', () =>
        HttpResponse.json({ data: { endProfileShare: endedPayload() } }),
      ),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    await user.click(await screen.findByRole('button', { name: 'End share with Cabin' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End share' }))

    await noticed('Sharing with Cabin ended.')
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load sharing.")
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shouldKeepTheConfirmationOpenWithTheServersWordsWhenEndingIsRefused', async () => {
    serveInTurn([share({ status: 'ACTIVE' })])
    server.use(
      graphql.mutation('EndProfileShare', () =>
        HttpResponse.json({
          errors: [{ message: 'forbidden', extensions: { code: 'FORBIDDEN' } }],
        }),
      ),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    await user.click(await screen.findByRole('button', { name: 'End share with Cabin' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'End share' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/^forbidden$/)
    expect(within(dialog).getByRole('button', { name: 'End share' })).toBeEnabled()
  })

  it('shouldReopenTheConfirmationWithTheServersWordsWhenRetryBringsTheSharesBackAfterARefusedEnd', async () => {
    serveSecondReadFailing([share({ status: 'ACTIVE' })])
    refuseToEnd()
    const { user } = renderWithProviders(<SharingScreen />)

    await user.click(await screen.findByRole('button', { name: 'End share with Cabin' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End share' }))
    expect(await screen.findByText("Couldn't load sharing.")).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    const dialog = await screen.findByRole('dialog', { name: 'End sharing with Cabin?' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('That share is not active.')
    expect(within(dialog).getByRole('button', { name: 'End share' })).toBeEnabled()
  })

  it('shouldReturnFocusToTheShareWhenThePersonClosesAConfirmationThatRetryBroughtBack', async () => {
    serveSecondReadFailing([share({ status: 'ACTIVE' })])
    refuseToEnd()
    const { user } = renderWithProviders(<SharingScreen />)
    await user.click(await screen.findByRole('button', { name: 'End share with Cabin' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End share' }))
    expect(await screen.findByText("Couldn't load sharing.")).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    const dialog = await screen.findByRole('dialog', { name: 'End sharing with Cabin?' })

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'End share with Cabin' })).toHaveFocus()
  })

  it('shouldMoveFocusToTheSharesHeadingWhenThePersonClosesAConfirmationThatRetryBroughtBackAfterTheShareEnded', async () => {
    serveSecondReadFailing([share({ status: 'ACTIVE' })], {
      afterFailure: [share({ status: 'ENDED', endedAt: '2026-11-01T12:00:00Z' })],
    })
    refuseToEnd()
    const { user } = renderWithProviders(<SharingScreen />)
    await user.click(await screen.findByRole('button', { name: 'End share with Cabin' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End share' }))
    expect(await screen.findByText("Couldn't load sharing.")).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    const dialog = await screen.findByRole('dialog', { name: 'End sharing with Cabin?' })

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: "Where Alex's Profile is shared" }),
    ).toHaveFocus()
  })

  it('shouldMoveFocusToTheSharesHeadingWhenThePersonClosesTheConfirmationAfterTheShareEnded', async () => {
    serveInTurn(
      [share({ status: 'ACTIVE' })],
      [share({ status: 'ENDED', endedAt: '2026-11-01T12:00:00Z' })],
    )
    refuseToEnd()
    const { user } = renderWithProviders(<SharingScreen />)
    await user.click(await screen.findByRole('button', { name: 'End share with Cabin' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'End share' }))
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled(),
    )

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: "Where Alex's Profile is shared" }),
    ).toHaveFocus()
  })

  it('shouldTakeTheServersWordsAwayWhenThePersonClosesTheConfirmation', async () => {
    serveInTurn([share({ status: 'ACTIVE' })])
    refuseToEnd()
    const { user } = renderWithProviders(<SharingScreen />)
    await user.click(await screen.findByRole('button', { name: 'End share with Cabin' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'End share' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That share is not active.')
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled(),
    )

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldOpenTheShareFormInPlaceWhenThePersonAsksToShare', async () => {
    serve()
    const { user } = renderWithProviders(<SharingScreen />)

    const field = await openShareForm(user)

    expect(field).toHaveFocus()
    expect(field).toHaveAccessibleDescription(
      'An admin of the other Household gives you this code.',
    )
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Share with another Household' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share with another Household' })).toHaveFocus()
  })

  it.each(['the Smiths', 'BCDF-GHJ', 'BCDF-GHJ1', CABIN_ID])(
    'shouldSayACodeIsEightLettersWithoutAskingTheServerWhenTheTextCannotBeOne(%j)',
    async (text) => {
      serve()
      const asked = serveShareCodeQuestions()
      const { user } = renderWithProviders(<SharingScreen />)

      const field = await openShareForm(user)
      await user.type(field, text)
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(field).toBeInvalid()
      expect(field).toHaveAccessibleDescription(
        expect.stringContaining('A share code is 8 letters, like BCDF-GHJK.'),
      )
      expect(field).toHaveValue(text)
      expect(asked.lookUps).toEqual([])
    },
  )

  it('shouldLookTheCodeUpOnceAndReviewTheOfferWhenTheCodeWorks', async () => {
    serve()
    const asked = serveShareCodeQuestions()
    const { user } = renderWithProviders(<SharingScreen />)

    await user.type(await openShareForm(user), ' bcdf ghjk ')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const question = await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })
    expect(question).toHaveFocus()
    expect(screen.getByText('An admin of Cabin must accept it. The code works once.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(asked.lookUps).toEqual([{ input: { code: SENT_SHARE_CODE } }])
    expect(asked.previews).toEqual([{ profileId: PROFILE_ID, shareCode: SENT_SHARE_CODE }])
  })

  it('shouldContinueWhenEnterIsPressedInTheField', async () => {
    serve()
    const { user } = renderWithProviders(<SharingScreen />)

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)

    expect(await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })).toBeVisible()
  })

  it('shouldTakeTheCodeOutOfALinkPastedIntoTheField', async () => {
    serve()
    const asked = serveShareCodeQuestions()
    const { user } = renderWithProviders(<SharingScreen />)

    await user.click(await openShareForm(user))
    await user.paste(`https://streamarr.example/settings/profile/sharing?code=${SHARE_CODE}`)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })).toBeVisible()
    expect(asked.lookUps).toEqual([{ input: { code: SENT_SHARE_CODE } }])
  })

  it('shouldSayTheOfferWasSentWhenReadingTheSharesAgainFails', async () => {
    serveOneReadThenFail([])
    server.use(graphql.mutation('OfferProfileShare', () => HttpResponse.json({ data: offered() })))
    const { user } = renderWithProviders(<SharingScreen />)

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))

    await noticed('Invitation sent to Cabin. An admin there must accept it.')
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load sharing.")
    expect(screen.queryByRole('heading', { name: 'Offer Alex to Cabin?' })).not.toBeInTheDocument()
  })

  it('shouldMoveFocusToTheHeadingAgainWhenASecondOfferBringsTheSameNotice', async () => {
    serve()
    server.use(graphql.mutation('OfferProfileShare', () => HttpResponse.json({ data: offered() })))
    const { user } = renderWithProviders(<SharingScreen />)
    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))
    await noticed('Invitation sent to Cabin. An admin there must accept it.')
    const field = await openShareForm(user)
    expect(field).toHaveFocus()

    await user.type(field, `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Offer Alex to Cabin?' }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Sharing' })).toHaveFocus()
  })

  it('shouldWriteTheNoticeAnewWhenASecondOfferBringsTheSameWords', async () => {
    serve()
    server.use(graphql.mutation('OfferProfileShare', () => HttpResponse.json({ data: offered() })))
    const { user } = renderWithProviders(<SharingScreen />)
    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))
    await noticed('Invitation sent to Cabin. An admin there must accept it.')
    const status = screen.getByRole('status')
    const first = within(status).getByText(
      'Invitation sent to Cabin. An admin there must accept it.',
    )

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))

    // The same words, written anew, so a screen reader reads them again.
    await waitFor(() =>
      expect(
        within(status).getByText('Invitation sent to Cabin. An admin there must accept it.'),
      ).not.toBe(first),
    )
  })

  it('shouldSayTheCodeDoesNotWorkAndKeepItWhenTheServerRefusesIt', async () => {
    serve()
    const asked = serveShareCodeQuestions({ lookUp: refusedShareCodeFixture() })
    const { user } = renderWithProviders(<SharingScreen />)

    const field = await openShareForm(user)
    await user.type(field, SHARE_CODE)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(field).toBeInvalid())
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining('That code does not work. Ask an admin there for a new one.'),
    )
    expect(field).toHaveValue(SHARE_CODE)
    expect(field).toHaveFocus()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(asked.previews).toEqual([])
  })

  it('shouldShowTheServersWordsWhenTheServerWillNotLookTheCodeUp', async () => {
    serve()
    server.use(
      graphql.mutation('LookUpShareCode', () =>
        HttpResponse.json({
          errors: [
            {
              message: 'Too many attempts. Try again in 15 minutes.',
              extensions: { code: 'TOO_MANY_CREDENTIAL_ATTEMPTS', retryAfterSeconds: 900 },
            },
          ],
        }),
      ),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    const field = await openShareForm(user)
    await user.type(field, `${SHARE_CODE}{Enter}`)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Too many attempts\. Try again in 15 minutes\.$/,
    )
    expect(field).toHaveValue(SHARE_CODE)
  })

  it('shouldKeepTheCodeInTheFieldWhileTheServerChecksIt', async () => {
    serve()
    const lookUp = heldAnswer(shareCodeLookUpFixture())
    server.use(graphql.mutation('LookUpShareCode', lookUp.answer))
    const { user } = renderWithProviders(<SharingScreen />)

    const field = await openShareForm(user)
    await user.type(field, `${SHARE_CODE}{Enter}`)
    await user.type(field, '{Backspace>9/}LMNP-QRST')

    expect(field).toHaveValue(SHARE_CODE)
    lookUp.release()
    await user.click(await screen.findByRole('button', { name: 'Back' }))
    expect(screen.getByRole('textbox', { name: 'Share code' })).toHaveValue(SHARE_CODE)
  })

  it('shouldWarnInTheReviewThatTheProfileWouldLockAndThatItsNameIsTaken', async () => {
    serve()
    serveShareCodeQuestions({
      preview: sharePreviewFixture({ wouldLock: true, nameConflict: true }),
    })
    const { user } = renderWithProviders(<SharingScreen />)

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)

    expect(
      await screen.findByText("Alex's Profile would be locked there until it has a PIN."),
    ).toBeVisible()
    expect(
      screen.getByText(
        'Another Profile there is already named Alex. An admin there cannot accept the share invitation until one of them is renamed.',
      ),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeEnabled()
  })

  it('shouldReturnToTheCodeWithItsTextAndFocusWhenThePersonGoesBack', async () => {
    serve()
    const asked = serveShareCodeQuestions()
    const { user } = renderWithProviders(<SharingScreen />)

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Back' }))

    const field = screen.getByRole('textbox', { name: 'Share code' })
    expect(field).toHaveValue(SHARE_CODE)
    expect(field).toHaveFocus()
    expect(field).toBeValid()
    expect(screen.queryByRole('heading', { name: 'Offer Alex to Cabin?' })).not.toBeInTheDocument()
    expect(asked.lookUps).toHaveLength(1)
  })

  it('shouldCloseTheFormFromTheReviewWhenThePersonCancels', async () => {
    serve()
    const { user } = renderWithProviders(<SharingScreen />)

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('heading', { name: 'Offer Alex to Cabin?' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share with another Household' })).toHaveFocus()
  })

  it('shouldOfferWithTheCodeAndSaySoWhenThePersonConfirmsTheReview', async () => {
    const shares = serveInTurn([], [share()])
    const asked = serveShareCodeQuestions()
    server.use(
      graphql.mutation('OfferProfileShare', ({ variables }) => {
        expect(variables).toEqual({ input: { profileId: PROFILE_ID, shareCode: SENT_SHARE_CODE } })
        return HttpResponse.json({ data: offered() })
      }),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))

    await noticed('Invitation sent to Cabin. An admin there must accept it.')
    expect(screen.queryByRole('heading', { name: 'Offer Alex to Cabin?' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Cancel invitation to Cabin' })).toBeVisible()
    expect(shares.calls).toBe(2)
    expect(asked.lookUps).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Sharing' })).toHaveFocus()
  })

  it('shouldReturnToTheCodeWithTheRefusalWhenTheReviewFindsTheCodeNoLongerWorks', async () => {
    serve()
    serveShareCodeQuestions({ preview: { profileSharePreview: null } })
    const { user } = renderWithProviders(<SharingScreen />)

    const field = await openShareForm(user)
    await user.type(field, `${SHARE_CODE}{Enter}`)

    await waitFor(() => expect(field).toBeInvalid())
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining('That code does not work. Ask an admin there for a new one.'),
    )
    expect(field).toHaveValue(SHARE_CODE)
    expect(screen.queryByRole('heading', { name: 'Offer Alex to Cabin?' })).not.toBeInTheDocument()
  })

  it('shouldReturnToTheCodeWithTheRefusalWhenTheOfferIsRefusedForItsCode', async () => {
    serve()
    server.use(
      graphql.mutation('OfferProfileShare', () =>
        HttpResponse.json({
          data: offerRefused('ShareCodeRefusedError', 'That share code does not work.'),
        }),
      ),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))

    const field = await screen.findByRole('textbox', { name: 'Share code' })
    expect(field).toBeInvalid()
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining('That code does not work. Ask an admin there for a new one.'),
    )
    expect(field).toHaveValue(SHARE_CODE)
    expect(field).toHaveFocus()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldShowTheServersWordsAndKeepTheReviewWhenTheOfferIsRefused', async () => {
    serve()
    server.use(
      graphql.mutation('OfferProfileShare', () =>
        HttpResponse.json({
          data: offerRefused(
            'ProfileAlreadySharedError',
            'That Profile already has a live share into that Household.',
          ),
        }),
      ),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^That Profile already has a live share into that Household\.$/,
    )
    expect(screen.getByRole('heading', { name: 'Offer Alex to Cabin?' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeEnabled()
  })

  it('shouldReportAnOfferTheServerRejectsInsteadOfSwallowingIt', async () => {
    serve()
    server.use(
      graphql.mutation('OfferProfileShare', () =>
        HttpResponse.json({
          errors: [{ message: 'forbidden', extensions: { code: 'FORBIDDEN' } }],
        }),
      ),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/^forbidden$/)
    expect(screen.getByRole('heading', { name: 'Offer Alex to Cabin?' })).toBeVisible()
  })

  it('shouldSayTheShareInvitationWasSentWhenItsAnswerIsLostAndTheSharesThenListIt', async () => {
    serve([], me([SMITH_FAMILY, CABIN]))
    const onServer = { shares: [] as ShareNode[] }
    server.use(
      graphql.query('ProfileShares', () =>
        HttpResponse.json({ data: sharesData(onServer.shares) }),
      ),
      graphql.mutation('OfferProfileShare', () => {
        onServer.shares = [share()]
        return networkFailure()
      }),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))

    await noticed('Invitation sent to Cabin. An admin there must accept it.')
    expect(screen.queryByRole('heading', { name: 'Offer Alex to Cabin?' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel invitation to Cabin' })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldSayTheShareInvitationWasSentWhenItsAnswerIsLostAndItPushesTheOldestShareOutOfAFullList', async () => {
    serve([], me([SMITH_FAMILY, CABIN]))
    const earlier = Array.from({ length: 50 }, (_, index) => endedShare(index))
    const onServer = { shares: earlier }
    server.use(
      graphql.query('ProfileShares', () =>
        HttpResponse.json({ data: sharesData(onServer.shares) }),
      ),
      graphql.mutation('OfferProfileShare', () => {
        // The server lists 50 shares, newest first, so the invitation takes the oldest one's place.
        onServer.shares = [share(), ...earlier.slice(0, 49)]
        return networkFailure()
      }),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))

    await noticed('Invitation sent to Cabin. An admin there must accept it.')
    expect(screen.getByRole('button', { name: 'Cancel invitation to Cabin' })).toBeVisible()
  })

  it('shouldSayTheShareInvitationWasNotSentWhenItsAnswerIsLostAndTheSharesDoNotListIt', async () => {
    // The server lists the share into the Account's own Household, which the page leaves out.
    const shares = serveInTurn([membershipShare()])
    server.use(graphql.mutation('OfferProfileShare', networkFailure))
    const { user } = renderWithProviders(<SharingScreen />)

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Couldn't send the share invitation\. Try again\.$/,
    )
    expect(shares.calls).toBe(2)
    expect(screen.getByRole('heading', { name: 'Offer Alex to Cabin?' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeEnabled()
  })

  it('shouldSayTheShareInvitationWasNotSentWhenTheOnlyNewShareIsOneSentEarlierInTheVisit', async () => {
    serveInTurn([], [share()])
    server.use(
      graphql.mutation(
        'LookUpShareCode',
        answersInTurn(
          answerWith(shareCodeLookUpFixture()),
          answerWith(shareCodeLookUpFixture({ householdName: 'Lake House' })),
        ).resolver,
      ),
      graphql.mutation(
        'OfferProfileShare',
        answersInTurn(answerWith(offered()), networkFailure).resolver,
      ),
    )
    const { user } = renderWithProviders(<SharingScreen />)
    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))
    await noticed('Invitation sent to Cabin. An admin there must accept it.')
    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await screen.findByRole('heading', { name: 'Offer Alex to Lake House?' })

    await user.click(screen.getByRole('button', { name: 'Send invitation' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Couldn't send the share invitation\. Try again\.$/,
    )
    expect(screen.getByRole('heading', { name: 'Offer Alex to Lake House?' })).toBeVisible()
  })

  it('shouldSayItCannotTellWhetherTheShareInvitationWasSentWhenTheSharesCannotBeReadEither', async () => {
    serve([], me([SMITH_FAMILY, CABIN]))
    const shares = answersInTurn(answerWith(sharesData()), serverFailure)
    server.use(
      graphql.query('ProfileShares', shares.resolver),
      graphql.mutation('OfferProfileShare', networkFailure),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Couldn't tell whether the share invitation was sent\. Try again\.$/,
    )
    expect(shares.calls).toBe(2)
    expect(screen.getByRole('heading', { name: 'Offer Alex to Cabin?' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeEnabled()
  })

  it('shouldSayTheShareInvitationWasSentWhenTheRetryIsRefusedBecauseTheLostOneSpentTheCode', async () => {
    serveAnOfferThatSpendsTheCodeWhileItsAnswerIsLost()
    const { user } = renderWithProviders(<SharingScreen />)
    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Send invitation' }))

    await noticed('Invitation sent to Cabin. An admin there must accept it.')
    expect(screen.getByRole('button', { name: 'Cancel invitation to Cabin' })).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Share code' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldSayTheShareInvitationWasSentWhenThePageListedItBeforeTheRefusedRetry', async () => {
    const shares = serveAnOfferThatSpendsTheCodeWhileItsAnswerIsLost()
    // Only the routed app reads its queries again when the browser comes back online.
    const { user } = renderAppAt(SHARING)
    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))
    await screen.findByRole('alert')
    await comeBackOnlineUntil(shares, 3)
    await screen.findByRole('button', { name: 'Cancel invitation to Cabin' })

    await user.click(screen.getByRole('button', { name: 'Send invitation' }))

    await noticed('Invitation sent to Cabin. An admin there must accept it.')
    expect(screen.queryByRole('textbox', { name: 'Share code' })).not.toBeInTheDocument()
  })

  it('shouldSayTheCodeDoesNotWorkWhenTheRetryAfterALostAnswerIsRefusedAndTheSharesListNothingNew', async () => {
    const shares = serveInTurn([])
    server.use(
      graphql.mutation('OfferProfileShare', answersInTurn(networkFailure, codeSpent()).resolver),
    )
    const { user } = renderWithProviders(<SharingScreen />)
    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Send invitation' }))

    const field = await screen.findByRole('textbox', { name: 'Share code' })
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining('That code does not work. Ask an admin there for a new one.'),
    )
    expect(shares.calls).toBe(3)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldSayItCannotTellWhetherTheShareInvitationWasSentWhenTheRetryIsRefusedAndTheSharesStillCannotBeRead', async () => {
    serve([], me([SMITH_FAMILY, CABIN]))
    const shares = answersInTurn(answerWith(sharesData()), serverFailure)
    server.use(
      graphql.query('ProfileShares', shares.resolver),
      graphql.mutation('OfferProfileShare', answersInTurn(networkFailure, codeSpent()).resolver),
    )
    const { user } = renderWithProviders(<SharingScreen />)
    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Send invitation' }))

    await waitFor(() => expect(shares.calls).toBe(3))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Couldn't tell whether the share invitation was sent\. Try again\.$/,
    )
    expect(screen.getByRole('heading', { name: 'Offer Alex to Cabin?' })).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Share code' })).not.toBeInTheDocument()
  })

  it('shouldNotReadTheSharesAgainWhenTheOfferIsRefusedAndNoAnswerWasLostBefore', async () => {
    const shares = serveInTurn([])
    server.use(graphql.mutation('OfferProfileShare', codeSpent()))
    const { user } = renderWithProviders(<SharingScreen />)
    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)

    await user.click(await screen.findByRole('button', { name: 'Send invitation' }))

    const field = await screen.findByRole('textbox', { name: 'Share code' })
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining('That code does not work. Ask an admin there for a new one.'),
    )
    expect(shares.calls).toBe(1)
  })

  it('shouldNotAskAboutTheCodeAgainWhenSharingIsReadAgainDuringTheReview', async () => {
    const shares = serveInTurn([])
    const asked = serveShareCodeQuestions()
    const { user } = renderAppAt(SHARING)
    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })

    await comeBackOnlineUntil(shares, 2)

    expect(screen.getByRole('heading', { name: 'Offer Alex to Cabin?' })).toBeVisible()
    expect(asked.lookUps).toHaveLength(1)
    expect(asked.previews).toHaveLength(1)
  })

  it('shouldKeepTheOfferBeingTypedWhileSharingIsReadAgain', async () => {
    const account = answersThenHolds({ me: me() }, { me: me() })
    const shares = answersThenHolds(sharesData(), sharesData([share()]))
    server.use(
      graphql.query('Me', account.resolver),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('ProfileShares', shares.resolver),
    )
    const { user } = renderAppAt(SHARING)
    const target = await openShareForm(user)
    await user.type(target, 'abc')

    comeBackOnline()
    await waitFor(() => expect(account.calls + shares.calls).toBeGreaterThan(3))
    expect(target).toBeInTheDocument()
    account.release()
    shares.release()

    expect(await screen.findByRole('button', { name: /^Cancel invitation/ })).toBeInTheDocument()
    expect(target).toBeInTheDocument()
    expect(target).toHaveValue('abc')
  })

  it('shouldKeepTheOfferBeingTypedWhenReadingSharingAgainFails', async () => {
    const fresh = heldAnswer(sharesData([share()]))
    const shares = answersInTurn(answerWith(sharesData()), serverFailure, fresh.answer)
    server.use(
      graphql.query('Me', () => HttpResponse.json({ data: { me: me() } })),
      graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
      graphql.query('ProfileShares', shares.resolver),
    )
    const { user } = renderAppAt(SHARING)
    const target = await openShareForm(user)
    await user.type(target, 'abc')

    await comeBackOnlineUntil(shares, 3)
    expect(target).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fresh.release()

    expect(await screen.findByRole('button', { name: /^Cancel invitation/ })).toBeInTheDocument()
    expect(target).toBeInTheDocument()
    expect(target).toHaveValue('abc')
  })

  it('shouldShowAnOfferAcceptedWhileThePersonWasAwayAsAShareWhenTheyReturn', async () => {
    serveReturnVisits([share()])
    const { user } = renderAppAt(SHARING)
    await screen.findByRole('button', { name: 'Cancel invitation to Cabin' })

    await leaveForHome(user, SHARING_PAGE)
    const accepted = sharesData([share({ status: 'ACTIVE' })])
    server.use(graphql.query('ProfileShares', answerWith(accepted)))
    await returnThroughTheProfileMenu(user, SHARING_PAGE)

    expect(await screen.findByRole('button', { name: 'End share with Cabin' })).toBeEnabled()
    expect(screen.queryByText('Waiting for an admin there')).not.toBeInTheDocument()
  })

  it('shouldShowSharingAsLoadingUntilTheServerAnswersWhenThePersonReturns', async () => {
    serveReturnVisits([share()])
    const { user } = renderAppAt(SHARING)
    await screen.findByRole('button', { name: 'Cancel invitation to Cabin' })

    await leaveForHome(user, SHARING_PAGE)
    server.use(graphql.query('ProfileShares', () => delay('infinite')))
    await returnThroughTheProfileMenu(user, SHARING_PAGE)

    expect(await screen.findByRole('status', { name: 'Loading sharing' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Cancel invitation to Cabin' }),
    ).not.toBeInTheDocument()
  })

  it('shouldSaySharingCouldNotLoadWhenReadingItFailsAsThePersonReturns', async () => {
    serveReturnVisits([share()])
    const { user } = renderAppAt(SHARING)
    await screen.findByRole('button', { name: 'Cancel invitation to Cabin' })

    await leaveForHome(user, SHARING_PAGE)
    server.use(graphql.query('ProfileShares', serverFailure))
    await returnThroughTheProfileMenu(user, SHARING_PAGE)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load sharing.")
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Cancel invitation to Cabin' }),
    ).not.toBeInTheDocument()
  })

  it('shouldShowSharingAsLoadingWhileTheAccountLoads', async () => {
    server.use(graphql.query('Me', () => delay('infinite')))
    renderWithProviders(<SharingScreen />)

    expect(await screen.findByRole('status', { name: 'Loading sharing' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldRetryWhenTheAccountFailsToLoad', async () => {
    serve()
    server.use(graphql.query('Me', failsOnceThen({ me: me() }).resolver))
    const { user } = renderWithProviders(<SharingScreen />)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load sharing.")

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(
      await screen.findByRole('region', { name: "Where Alex's Profile is shared" }),
    ).toBeVisible()
  })

  it('shouldShowTheServersWordsWhenTheServerRefusesToReadTheAccount', async () => {
    server.use(graphql.query('Me', () => refusedWith('This session may not read its account.')))
    renderWithProviders(<SharingScreen />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^This session may not read its account\.$/,
    )
  })

  it('shouldRetryWhenSharingFailsToLoad', async () => {
    serve()
    const shares = failsOnceThen(sharesData())
    server.use(graphql.query('ProfileShares', shares.resolver))
    const { user } = renderWithProviders(<SharingScreen />)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load sharing.")

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(
      await screen.findByRole('region', { name: "Where Alex's Profile is shared" }),
    ).toBeVisible()
    expect(shares.calls).toBe(2)
  })

  it('shouldShowTheServersWordsWhenTheServerRefusesToListTheShares', async () => {
    serve()
    server.use(
      graphql.query('ProfileShares', () => refusedWith('You may not see where Alex is shared.')),
    )
    renderWithProviders(<SharingScreen />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^You may not see where Alex is shared\.$/,
    )
  })

  it('shouldSayThereIsNoProfileToShareWithoutOfferingRetry', async () => {
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({
          data: { me: meFixture({ profiles: [profileFixture({ personal: false })] }) },
        }),
      ),
    )
    renderWithProviders(<SharingScreen />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Sharing' })).toBeVisible()
    expect(
      await screen.findByText('You have no Profile of your own in Smith Family to share.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })
})

function canceledPayload() {
  return {
    __typename: 'CancelProfileSharePayload',
    share: { __typename: 'ProfileShare', id: SHARE_ID, status: 'CANCELED' },
    userErrors: [],
  }
}

function agreeToCancel() {
  server.use(
    graphql.mutation('CancelProfileShare', () =>
      HttpResponse.json({ data: { cancelProfileShare: canceledPayload() } }),
    ),
  )
}

function notPendingPayload() {
  return {
    __typename: 'CancelProfileSharePayload',
    share: null,
    userErrors: [{ __typename: 'ShareNotPendingError', message: 'That offer is not pending.' }],
  }
}

function refuseToCancel() {
  server.use(
    graphql.mutation('CancelProfileShare', () =>
      HttpResponse.json({ data: { cancelProfileShare: notPendingPayload() } }),
    ),
  )
}

function refuseToEnd() {
  server.use(
    graphql.mutation('EndProfileShare', () =>
      HttpResponse.json({
        data: {
          endProfileShare: {
            __typename: 'EndProfileSharePayload',
            share: null,
            userErrors: [
              { __typename: 'ShareNotActiveError', message: 'That share is not active.' },
            ],
          },
        },
      }),
    ),
  )
}

function offerRefused(typename: string, message: string) {
  return {
    offerProfileShare: {
      __typename: 'OfferProfileSharePayload',
      share: null,
      userErrors: [{ __typename: typename, message }],
    },
  }
}

// A share into another Household that ended, the `index`th from the newest.
function endedShare(index: number): ShareNode {
  return share({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    status: 'ENDED',
    endedAt: '2026-11-01T12:00:00Z',
  })
}

// The server takes the first offer but its answer is lost, and the shares cannot be read while the
// connection is down. Once it is back, the shares list that offer, and a retry finds its code spent.
function serveAnOfferThatSpendsTheCodeWhileItsAnswerIsLost() {
  serve([], me([SMITH_FAMILY, CABIN]))
  const shares = answersInTurn(
    answerWith(sharesData()),
    serverFailure,
    answerWith(sharesData([share()])),
  )
  server.use(
    graphql.query('ProfileShares', shares.resolver),
    graphql.mutation('OfferProfileShare', answersInTurn(networkFailure, codeSpent()).resolver),
  )
  return shares
}

// The server's refusal of an offer whose code an earlier offer spent.
function codeSpent() {
  return answerWith(offerRefused('ShareCodeRefusedError', 'That share code does not work.'))
}

function endedPayload() {
  return {
    __typename: 'EndProfileSharePayload',
    share: { __typename: 'ProfileShare', id: SHARE_ID, status: 'ENDED' },
    userErrors: [],
  }
}

// The confirmation holds a status of its own while a request is on its way, so the page's notice
// is the one status only once the confirmation has closed.
async function noticed(text: string) {
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(text))
}
