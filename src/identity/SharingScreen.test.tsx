import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, graphql, HttpResponse, type GraphQLQuery } from 'msw'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type {
  ProfileShareStatus,
  ProfileSharesQuery,
  ProfileSharesQueryVariables,
} from '../graphql/generated/graphql'
import {
  answersInTurn,
  answersThenHolds,
  answerWith,
  comeBackOnline,
  comeBackOnlineUntil,
  failsOnceThen,
  heldAnswer,
  readsThatCanBeHeld,
  serverFailure,
} from '../test/graphqlResponses'
import { focusesOf, leaveTheConfirmation, type WayOut } from '../test/focus'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { profileLanguagesFixture } from '../test/languageFixtures'
import { HOUSEHOLD_ID, meFixture, PROFILE_ID, profileFixture } from '../test/meFixture'
import { renderAppAt, renderWithProviders } from '../test/render'
import { leaveForHome, returnThroughTheProfileMenu, type SettingsPage } from '../test/returnVisits'
import { server } from '../test/server'
import {
  refusedShareCodeFixture,
  SENT_SHARE_CODE,
  shareCodeLookUpFixture,
  serveShareCodeQuestions,
  SHARE_CODE,
  sharePreviewFixture,
} from '../test/shareCodeFixtures'
import { followingShareChanges, liveShare, shareChanged } from '../test/shareChangeFixtures'
import { SharingScreen } from './SharingScreen'

type ShareFields = ProfileSharesQuery['profileShares']['edges'][number]['node']
type ShareNode = Omit<ShareFields, 'household'> & {
  __typename: 'ProfileShare'
  household: (NonNullable<ShareFields['household']> & { __typename: 'HouseholdSummary' }) | null
}

const SHARING = '/settings/profile/sharing'
const SHARING_PAGE: SettingsPage = {
  area: 'Profile settings',
  section: 'Sharing',
  heading: 'Sharing',
}
const SHARE_ID = '77777777-7777-7777-7777-777777777777'
const CABIN_ID = '55555555-5555-5555-5555-555555555555'
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
    household: { __typename: 'HouseholdSummary', id: CABIN_ID, name: 'Cabin' },
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
    household: { __typename: 'HouseholdSummary', id: HOUSEHOLD_ID, name: 'Smith Family' },
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

const LIVE: readonly ProfileShareStatus[] = ['PENDING', 'ACTIVE']
const OVER: readonly ProfileShareStatus[] = [
  'REJECTED',
  'CANCELED',
  'EXPIRED',
  'INVALIDATED',
  'ENDED',
]
// The page size of the page's reads of shares.
const PAGE = 50

// Every status when the read asks for none, as the server answers.
function asksFor(statuses: ProfileSharesQueryVariables['statuses'], status: ProfileShareStatus) {
  const asked = [statuses].flat()
  return asked.length === 0 || asked.includes(status)
}

// A Profile's shares as the server lists them: in the statuses asked for, a page at a time.
function listedShares(shares: ShareNode[], variables: ProfileSharesQueryVariables) {
  expect(variables.profileId).toBe(PROFILE_ID)
  return sharesData(
    shares.filter((share) => asksFor(variables.statuses, share.status)).slice(0, PAGE),
  )
}

function serve(shares: ShareNode[] = [], account = me()) {
  const socket = serveGraphqlSocket()
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: account } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query<ProfileSharesQuery, ProfileSharesQueryVariables>(
      'ProfileShares',
      ({ variables }) => HttpResponse.json({ data: listedShares(shares, variables) }),
    ),
  )
  serveShareCodeQuestions()
  return socket
}

// Answers each read of the shares with the next list, and the last list from then on.
function serveInTurn(...lists: ShareNode[][]) {
  serve([], me([SMITH_FAMILY, CABIN]))
  const handler = answersInTurn(...lists.map((shares) => answerWith(sharesData(shares))))
  server.use(graphql.query('ProfileShares', handler.resolver))
  return handler
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

    const shared = await screen.findByRole('region', { name: 'Where Alex is shared' })
    expect(within(shared).getByText('Alex is not shared with another Household.')).toBeVisible()
    expect(within(shared).queryByRole('listitem')).not.toBeInTheDocument()
    expect(within(shared).queryByText('Smith Family')).not.toBeInTheDocument()
    expect(
      within(shared).getByRole('button', { name: 'Share with another Household' }),
    ).toBeEnabled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^Offers/ })).not.toBeInTheDocument()
  })

  it('shouldNameTheHouseholdByTheNameTheShareCarriesWhenTheAccountMayUseOnlyItsOwnHousehold', async () => {
    // The Account may use only its own Household, so the name can come from the share alone.
    serve([membershipShare(), share({ status: 'ACTIVE' })], me([SMITH_FAMILY]))
    renderWithProviders(<SharingScreen />)

    const row = await screen.findByRole('listitem')
    expect(row).toHaveTextContent('Cabin')
    expect(within(row).getByRole('button', { name: 'End share with Cabin' })).toBeEnabled()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('shouldSayAnotherHouseholdWhenAShareCarriesNoHousehold', async () => {
    serve([share({ status: 'ACTIVE', household: null })])
    const { user } = renderWithProviders(<SharingScreen />)

    const row = await screen.findByRole('listitem')
    expect(row).toHaveTextContent('another Household')
    await user.click(within(row).getByRole('button', { name: 'End share with another Household' }))

    expect(
      screen.getByRole('dialog', { name: 'End sharing with another Household?' }),
    ).toBeVisible()
  })

  it('shouldShowAnOfferAsWaitingWithTheTimeItHasLeft', async () => {
    const inSixDays = new Date(Date.now() + 6 * DAY + DAY / 24).toISOString()
    serve([share({ expiresAt: inSixDays })])
    renderWithProviders(<SharingScreen />)

    const row = await screen.findByRole('listitem')
    expect(row).toHaveTextContent('Cabin')
    expect(within(row).getByText('Waiting for an admin there')).toBeVisible()
    expect(within(row).getByText('Expires in 6 days')).toBeVisible()
    expect(within(row).getByRole('button', { name: 'Cancel offer to Cabin' })).toBeEnabled()
  })

  it('shouldMoveAnOfferToEarlierOffersWhenItsTimeRunsOutWithThePageOpen', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true })
    onTestFinished(() => void vi.useRealTimers())
    serve([share({ expiresAt: new Date(Date.now() + DAY / 24).toISOString() })])
    const { user } = renderWithProviders(<SharingScreen />)
    await screen.findByRole('button', { name: 'Cancel offer to Cabin' })

    await act(() => vi.advanceTimersByTimeAsync(DAY / 24))

    expect(await screen.findByText('Alex is not shared with another Household.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Cancel offer to Cabin' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Earlier offers and shares' }))
    expect(screen.getByRole('listitem')).toHaveTextContent('CabinExpired')
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

    const earlier = await screen.findByRole('button', { name: 'Earlier offers and shares' })
    expect(earlier).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    expect(screen.getByText('Alex is not shared with another Household.')).toBeVisible()

    await user.click(earlier)

    expect(earlier).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'CabinDeclined',
      'CabinExpired',
      'CabinCanceled',
      'CabinEnded Aug 20, 2026',
      'CabinWithdrawn: Its offerer left.',
    ])
    expect(screen.queryByRole('button', { name: /^End share|^Cancel offer/ })).toBeNull()
  })

  it('shouldListALiveShareWhenAPageOfEarlierSharesIsNewer', async () => {
    const earlier = Array.from({ length: PAGE }, (_, at) =>
      share({ id: `ended-${at}`, status: 'ENDED', endedAt: '2026-08-20T12:00:00Z' }),
    )
    serve([...earlier, share({ status: 'ACTIVE' })])
    renderWithProviders(<SharingScreen />)

    expect(await screen.findByRole('button', { name: 'End share with Cabin' })).toBeEnabled()
  })

  it('shouldReadEarlierOffersAndSharesOnlyWhenThePersonOpensThem', async () => {
    const asked: ProfileSharesQueryVariables[] = []
    const shares = [share({ status: 'ACTIVE' }), share({ id: 'declined', status: 'REJECTED' })]
    serve()
    server.use(
      graphql.query<ProfileSharesQuery, ProfileSharesQueryVariables>(
        'ProfileShares',
        ({ variables }) => {
          asked.push(variables)
          return HttpResponse.json({ data: listedShares(shares, variables) })
        },
      ),
    )
    const { user } = renderWithProviders(<SharingScreen />)
    await screen.findByRole('button', { name: 'End share with Cabin' })
    expect(asked.map(({ statuses }) => statuses)).toEqual([LIVE])

    await user.click(screen.getByRole('button', { name: 'Earlier offers and shares' }))

    expect(await screen.findByText('Declined')).toBeVisible()
    expect(asked.map(({ statuses }) => statuses)).toEqual([LIVE, OVER])
  })

  it('shouldSayThereAreNoEarlierOffersOrSharesWhenThereAreNone', async () => {
    serve([share({ status: 'ACTIVE' })])
    const { user } = renderWithProviders(<SharingScreen />)

    await user.click(await screen.findByRole('button', { name: 'Earlier offers and shares' }))

    expect(await screen.findByText('No earlier offers or shares.')).toBeVisible()
  })

  it('shouldRetryEarlierOffersAndSharesInTheirPlaceWhenTheyFailToLoad', async () => {
    serve([share({ status: 'ACTIVE' })])
    const over = failsOnceThen(sharesData([share({ id: 'declined', status: 'REJECTED' })]))
    const live = sharesData([share({ status: 'ACTIVE' })])
    server.use(
      graphql.query<GraphQLQuery, ProfileSharesQueryVariables>('ProfileShares', ({ variables }) =>
        asksFor(variables.statuses, 'ACTIVE') ? HttpResponse.json({ data: live }) : over.resolver(),
      ),
    )
    const { user } = renderWithProviders(<SharingScreen />)
    await user.click(await screen.findByRole('button', { name: 'Earlier offers and shares' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load earlier offers and shares.",
    )
    expect(screen.getByRole('button', { name: 'End share with Cabin' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Declined')).toBeVisible()
  })

  it('shouldCancelAPendingOfferAndSaySo', async () => {
    const shares = serveInTurn([share()], [])
    let canceled = false
    server.use(
      graphql.mutation('CancelProfileShare', ({ variables }) => {
        expect(variables).toEqual({ input: { shareId: SHARE_ID } })
        canceled = true
        return HttpResponse.json({
          data: {
            cancelProfileShare: {
              __typename: 'CancelProfileSharePayload',
              share: { __typename: 'ProfileShare', id: SHARE_ID, status: 'CANCELED' },
              userErrors: [],
            },
          },
        })
      }),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    await user.click(await screen.findByRole('button', { name: 'Cancel offer to Cabin' }))

    await noticed('Offer to Cabin canceled.')
    expect(canceled).toBe(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(shares.calls).toBe(2))
  })

  it('shouldShowTheServersWordsAndReadTheSharesAgainWhenCancelingIsRefused', async () => {
    const shares = serveInTurn([share()], [share()])
    server.use(
      graphql.mutation('CancelProfileShare', () =>
        HttpResponse.json({
          data: {
            cancelProfileShare: {
              __typename: 'CancelProfileSharePayload',
              share: null,
              userErrors: [
                { __typename: 'ShareNotPendingError', message: 'That offer is not pending.' },
              ],
            },
          },
        }),
      ),
    )
    const { user } = renderWithProviders(<SharingScreen />)

    await user.click(await screen.findByRole('button', { name: 'Cancel offer to Cabin' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('That offer is not pending.')
    await waitFor(() => expect(shares.calls).toBe(2))
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
      'Alex stops being available in Cabin. The TVs you linked there are unlinked, and your sessions there return to Smith Family. Sharing again needs a new offer and an admin there to accept it.',
    )
    expect(ended).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(ended).toBe(false)
  })

  it.each<WayOut>(['Cancel', 'Escape'])(
    'shouldReturnFocusToEndShareWhenThePersonLeavesItsConfirmation(%s)',
    async (way) => {
      serveInTurn([share({ status: 'ACTIVE' })])
      const { user } = renderWithProviders(<SharingScreen />)
      const end = await screen.findByRole('button', { name: 'End share with Cabin' })
      const heading = focusesOf(screen.getByRole('heading', { level: 1, name: 'Sharing' }))

      await user.click(end)
      await leaveTheConfirmation(user, way)

      await waitFor(() => expect(end).toHaveFocus())
      expect(heading.count).toBe(0)
    },
  )

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
    expect(screen.getByRole('button', { name: 'Offer share' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(asked.lookUps).toEqual([{ input: { code: SENT_SHARE_CODE } }])
    expect(asked.previews).toEqual([{ profileId: PROFILE_ID, shareCode: SENT_SHARE_CODE }])
  })

  it('shouldAskOnlyForThePreviewAgainWhenThePreviewFailedAndThePersonContinues', async () => {
    serve()
    const asked = serveShareCodeQuestions()
    const preview = failsOnceThen(sharePreviewFixture())
    server.use(graphql.query('ProfileSharePreview', preview.resolver))
    const { user } = renderWithProviders(<SharingScreen />)
    await user.type(await openShareForm(user), SHARE_CODE)

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })).toBeVisible()
    expect(asked.lookUps).toHaveLength(1)
    expect(preview.calls).toBe(2)
  })

  it('shouldLookTheCodeUpAgainWhenThePersonChangesIt', async () => {
    serve()
    const asked = serveShareCodeQuestions()
    server.use(graphql.query('ProfileSharePreview', failsOnceThen(sharePreviewFixture()).resolver))
    const { user } = renderWithProviders(<SharingScreen />)
    const field = await openShareForm(user)
    await user.type(field, SHARE_CODE)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('alert')

    await user.clear(field)
    await user.type(field, 'BCDF-GHJL')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })).toBeVisible()
    expect(asked.lookUps).toEqual([
      { input: { code: SENT_SHARE_CODE } },
      { input: { code: 'BCDFGHJL' } },
    ])
  })

  it('shouldLeaveTheLookUpsAnswerOutWhenThePersonChangedTheCodeWhileItWasChecked', async () => {
    serve()
    const asked = serveShareCodeQuestions()
    const lookUp = heldAnswer(shareCodeLookUpFixture())
    server.use(graphql.mutation('LookUpShareCode', lookUp.answer))
    const { user } = renderWithProviders(<SharingScreen />)
    const field = await openShareForm(user)
    await user.type(field, SHARE_CODE)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await user.type(field, 'L')
    lookUp.release()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled())
    expect(screen.queryByRole('heading', { name: 'Offer Alex to Cabin?' })).not.toBeInTheDocument()
    expect(field).toHaveValue(`${SHARE_CODE}L`)
    expect(asked.previews).toEqual([])
  })

  it('shouldContinueWhenEnterIsPressedInTheField', async () => {
    serve()
    const { user } = renderWithProviders(<SharingScreen />)

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)

    expect(await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })).toBeVisible()
  })

  it('shouldMoveFocusFromTheFieldToTheReviewWithoutThePageHeadingWhenEnterIsPressed', async () => {
    serve()
    const { user } = renderWithProviders(<SharingScreen />)
    const field = await openShareForm(user)
    const heading = focusesOf(screen.getByRole('heading', { level: 1, name: 'Sharing' }))

    await user.type(field, `${SHARE_CODE}{Enter}`)

    expect(await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })).toHaveFocus()
    expect(heading.count).toBe(0)
  })

  it.each([
    `https://streamarr.example/settings/profile/sharing#code=${SHARE_CODE}`,
    `https://streamarr.example/settings/profile/sharing?code=${SHARE_CODE}`,
  ])('shouldTakeTheCodeOutOfALinkWhenTheLinkIsPastedIntoTheField(%s)', async (link) => {
    serve()
    const asked = serveShareCodeQuestions()
    const { user } = renderWithProviders(<SharingScreen />)

    await user.click(await openShareForm(user))
    await user.paste(link)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })).toBeVisible()
    expect(asked.lookUps).toEqual([{ input: { code: SENT_SHARE_CODE } }])
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

  it('shouldWarnInTheReviewWhenTheProfileWouldLockAndItsNameIsTaken', async () => {
    serve()
    serveShareCodeQuestions({
      preview: sharePreviewFixture({ wouldLock: true, nameConflict: true }),
    })
    const { user } = renderWithProviders(<SharingScreen />)

    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)

    expect(
      await screen.findByText('Alex would arrive locked there until it has a PIN.'),
    ).toBeVisible()
    expect(
      screen.getByText(
        'Another Profile there is already named Alex. An admin there cannot accept the offer until one of them is renamed.',
      ),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Offer share' })).toBeEnabled()
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

  it('shouldShowTheSameReviewWithoutAskingAgainWhenThePersonGoesBackAndContinuesWithTheSameCode', async () => {
    serve()
    const asked = serveShareCodeQuestions({ preview: sharePreviewFixture({ wouldLock: true }) })
    const { user } = renderWithProviders(<SharingScreen />)
    await user.type(await openShareForm(user), `${SHARE_CODE}{Enter}`)
    await user.click(await screen.findByRole('button', { name: 'Back' }))

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('heading', { name: 'Offer Alex to Cabin?' })).toHaveFocus()
    expect(screen.getByText('Alex would arrive locked there until it has a PIN.')).toBeVisible()
    expect(asked.lookUps).toHaveLength(1)
    expect(asked.previews).toHaveLength(1)
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
    await user.click(await screen.findByRole('button', { name: 'Offer share' }))

    await noticed('Offer sent to Cabin. An admin there must accept it.')
    expect(screen.queryByRole('heading', { name: 'Offer Alex to Cabin?' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Cancel offer to Cabin' })).toBeVisible()
    expect(shares.calls).toBe(2)
    expect(asked.lookUps).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Sharing' })).toHaveFocus()
  })

  it('shouldSayTheOfferCannotBeMadeWithoutAskingAgainWhenThePreviewAnswersNothing', async () => {
    serve()
    // The server answers no preview for a code that stopped working, and for a Profile that the
    // Account may not offer.
    const asked = serveShareCodeQuestions({ preview: { profileSharePreview: null } })
    const { user } = renderWithProviders(<SharingScreen />)

    const field = await openShareForm(user)
    await user.type(field, `${SHARE_CODE}{Enter}`)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^This offer cannot be made\. The code may have stopped working, or you may not be able to share Alex\.$/,
    )
    expect(field).toHaveValue(SHARE_CODE)
    expect(field).toBeValid()
    expect(screen.queryByRole('heading', { name: 'Offer Alex to Cabin?' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/^This offer cannot be made\./)
    expect(asked.lookUps).toHaveLength(1)
    expect(asked.previews).toHaveLength(1)
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
    await user.click(await screen.findByRole('button', { name: 'Offer share' }))

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
    await user.click(await screen.findByRole('button', { name: 'Offer share' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^That Profile already has a live share into that Household\.$/,
    )
    expect(screen.getByRole('heading', { name: 'Offer Alex to Cabin?' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Offer share' })).toBeEnabled()
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
    await user.click(await screen.findByRole('button', { name: 'Offer share' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/^forbidden$/)
    expect(screen.getByRole('heading', { name: 'Offer Alex to Cabin?' })).toBeVisible()
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

    expect(await screen.findByRole('button', { name: /^Cancel offer/ })).toBeInTheDocument()
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

    expect(await screen.findByRole('button', { name: /^Cancel offer/ })).toBeInTheDocument()
    expect(target).toBeInTheDocument()
    expect(target).toHaveValue('abc')
  })

  it('shouldShowAnOfferAcceptedWhileThePersonWasAwayAsAShareWhenTheyReturn', async () => {
    serveReturnVisits([share()])
    const { user } = renderAppAt(SHARING)
    await screen.findByRole('button', { name: 'Cancel offer to Cabin' })

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
    await screen.findByRole('button', { name: 'Cancel offer to Cabin' })

    await leaveForHome(user, SHARING_PAGE)
    server.use(graphql.query('ProfileShares', () => delay('infinite')))
    await returnThroughTheProfileMenu(user, SHARING_PAGE)

    expect(await screen.findByRole('status', { name: 'Loading sharing' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel offer to Cabin' })).not.toBeInTheDocument()
  })

  it('shouldSaySharingCouldNotLoadWhenReadingItFailsAsThePersonReturns', async () => {
    serveReturnVisits([share()])
    const { user } = renderAppAt(SHARING)
    await screen.findByRole('button', { name: 'Cancel offer to Cabin' })

    await leaveForHome(user, SHARING_PAGE)
    server.use(graphql.query('ProfileShares', serverFailure))
    await returnThroughTheProfileMenu(user, SHARING_PAGE)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load sharing.")
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Cancel offer to Cabin' })).not.toBeInTheDocument()
  })

  it('shouldRetryWhenTheAccountFailsToLoad', async () => {
    serve()
    server.use(graphql.query('Me', failsOnceThen({ me: me() }).resolver))
    const { user } = renderWithProviders(<SharingScreen />)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load sharing.")

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('region', { name: 'Where Alex is shared' })).toBeVisible()
  })

  it('shouldRetryWhenSharingFailsToLoad', async () => {
    serve()
    const shares = failsOnceThen(sharesData())
    server.use(graphql.query('ProfileShares', shares.resolver))
    const { user } = renderWithProviders(<SharingScreen />)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load sharing.")

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('region', { name: 'Where Alex is shared' })).toBeVisible()
    expect(shares.calls).toBe(2)
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

function offerRefused(typename: string, message: string) {
  return {
    offerProfileShare: {
      __typename: 'OfferProfileSharePayload',
      share: null,
      userErrors: [{ __typename: typename, message }],
    },
  }
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

describe('Sharing as shares change elsewhere', () => {
  // A share of Alex as the Profile's manager receives it.
  function changedShare(overrides: Parameters<typeof liveShare>[0] = {}) {
    return liveShare({
      householdId: CABIN_ID,
      household: { __typename: 'HouseholdSummary', id: CABIN_ID, name: 'Cabin' },
      ...overrides,
    })
  }

  async function openWith(shares: ShareNode[]) {
    const socket = serve([membershipShare(), ...shares], me([SMITH_FAMILY, CABIN]))
    // The whole app, whose reads after a missed change belong to its signed-in pages.
    const rendered = renderAppAt(SHARING)
    await screen.findByRole('region', { name: 'Where Alex is shared' })
    await followingShareChanges(socket)
    return { socket, ...rendered }
  }

  it('shouldListAnOfferWhenTheProfileIsOfferedElsewhereWhileThePageIsOpen', async () => {
    const { socket } = await openWith([])

    socket.publish('ProfileShareChanged', shareChanged(SHARE_ID, changedShare()))

    expect(await screen.findByRole('button', { name: 'Cancel offer to Cabin' })).toBeEnabled()
    expect(screen.queryByText('Alex is not shared with another Household.')).not.toBeInTheDocument()
  })

  it('shouldShowAnOfferAsSharedWhenItIsAcceptedElsewhere', async () => {
    const { socket } = await openWith([share()])
    expect(screen.getByText('Waiting for an admin there')).toBeVisible()

    socket.publish(
      'ProfileShareChanged',
      shareChanged(SHARE_ID, changedShare({ status: 'ACTIVE' })),
    )

    expect(await screen.findByRole('button', { name: 'End share with Cabin' })).toBeEnabled()
    expect(screen.queryByText('Waiting for an admin there')).not.toBeInTheDocument()
  })

  it('shouldTakeOutAShareThatNoLongerExistsWhenItsHouseholdIsDeleted', async () => {
    const { socket } = await openWith([share({ status: 'ACTIVE' })])
    await screen.findByRole('button', { name: 'End share with Cabin' })

    socket.publish('ProfileShareChanged', shareChanged(SHARE_ID, null))

    expect(await screen.findByText('Alex is not shared with another Household.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'End share with Cabin' })).not.toBeInTheDocument()
  })

  it('shouldKeepAShareWhenItsChangeArrivesWithErrors', async () => {
    const { socket } = await openWith([share({ status: 'ACTIVE' })])
    // The change is reported missed, so the shares read again; held, that read cannot hide what
    // the change did to the list.
    server.use(graphql.query('ProfileShares', () => delay('infinite')))

    socket.publish('ProfileShareChanged', {
      data: {
        profileShareChanged: { __typename: 'ProfileShareChange', shareId: SHARE_ID, share: null },
      },
      errors: [{ message: 'boom', path: ['profileShareChanged', 'share'] }],
    })
    socket.publish(
      'ProfileShareChanged',
      shareChanged(
        'lake-house',
        changedShare({
          id: 'lake-house',
          householdId: 'lake-house',
          household: { __typename: 'HouseholdSummary', id: 'lake-house', name: 'Lake House' },
        }),
      ),
    )

    await screen.findByRole('button', { name: 'Cancel offer to Lake House' })
    expect(screen.getByRole('button', { name: 'End share with Cabin' })).toBeEnabled()
  })

  it('shouldLeaveOutAShareOfAnotherProfileWhenItsChangeArrives', async () => {
    const { socket } = await openWith([])

    socket.publish(
      'ProfileShareChanged',
      shareChanged('robin', changedShare({ id: 'robin', profileId: 'robin', status: 'ACTIVE' })),
    )
    socket.publish('ProfileShareChanged', shareChanged(SHARE_ID, changedShare()))

    await screen.findByRole('button', { name: 'Cancel offer to Cabin' })
    expect(screen.queryByRole('button', { name: 'End share with Cabin' })).not.toBeInTheDocument()
  })

  it('shouldKeepTheShareFormAsTypedWhenAShareChangesElsewhere', async () => {
    const { socket, user } = await openWith([share()])
    const field = await openShareForm(user)
    await user.type(field, 'BCDF')

    socket.publish(
      'ProfileShareChanged',
      shareChanged(SHARE_ID, changedShare({ status: 'ACTIVE' })),
    )

    await screen.findByRole('button', { name: 'End share with Cabin' })
    expect(screen.getByRole('textbox', { name: 'Share code' })).toHaveValue('BCDF')
    expect(screen.getByRole('textbox', { name: 'Share code' })).toHaveFocus()
  })

  it('shouldCloseTheConfirmationAndSaySoWhenTheShareEndsElsewhereMeanwhile', async () => {
    const { socket, user } = await openWith([share({ status: 'ACTIVE' })])
    await user.click(screen.getByRole('button', { name: 'End share with Cabin' }))

    socket.publish('ProfileShareChanged', shareChanged(SHARE_ID, changedShare({ status: 'ENDED' })))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await noticed('Sharing with Cabin has already ended.')
    expect(screen.getByRole('heading', { level: 1, name: 'Sharing' })).toHaveFocus()
  })

  it('shouldMoveAShareToEarlierOffersAndSharesWhenItEndsElsewhere', async () => {
    const { socket, user } = await openWith([
      share({ status: 'ACTIVE' }),
      share({ id: 'declined', status: 'REJECTED' }),
    ])
    await user.click(screen.getByRole('button', { name: 'Earlier offers and shares' }))
    await screen.findByText('Declined')

    socket.publish(
      'ProfileShareChanged',
      shareChanged(SHARE_ID, changedShare({ status: 'ENDED', endedAt: '2026-11-10T12:00:00Z' })),
    )

    await screen.findByText('Alex is not shared with another Household.')
    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'CabinEnded Nov 10, 2026',
      'CabinDeclined',
    ])
  })

  it('shouldMoveFocusToTheHeadingWhenTheShareThePersonIsOnEndsElsewhere', async () => {
    const { socket } = await openWith([share({ status: 'ACTIVE' })])
    act(() => screen.getByRole('button', { name: 'End share with Cabin' }).focus())

    socket.publish('ProfileShareChanged', shareChanged(SHARE_ID, changedShare({ status: 'ENDED' })))

    await screen.findByText('Alex is not shared with another Household.')
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Sharing' })).toHaveFocus(),
    )
  })

  describe('while a read of the shares is on its way', () => {
    const LAKE_HOUSE_ID = '44444444-4444-4444-4444-444444444444'
    const lakeHouse = share({
      id: 'lake-house',
      householdId: LAKE_HOUSE_ID,
      status: 'ACTIVE',
      household: { __typename: 'HouseholdSummary', id: LAKE_HOUSE_ID, name: 'Lake House' },
    })

    // The shares the server holds; each read answers with them as they stood when it arrived.
    async function openWithAReadOnItsWay(shares: ShareNode[]) {
      const held = { shares: [membershipShare(), ...shares] }
      const socket = serve([], me([SMITH_FAMILY, CABIN]))
      const reads = readsThatCanBeHeld(() => sharesData(held.shares))
      server.use(graphql.query('ProfileShares', reads.resolver))
      renderAppAt(SHARING)
      await screen.findByRole('region', { name: 'Where Alex is shared' })
      await followingShareChanges(socket)
      // The share with Lake House shows that the held read has answered.
      held.shares = [lakeHouse, ...held.shares]
      const read = reads.holdNext()
      comeBackOnline()
      await read.arrived
      return { held, socket, release: read.release }
    }

    it('shouldKeepAnOfferMadeElsewhereWhenAReadSentBeforeItAnswers', async () => {
      const { held, socket, release } = await openWithAReadOnItsWay([])

      held.shares = [share(), ...held.shares]
      socket.publish('ProfileShareChanged', shareChanged(SHARE_ID, changedShare()))
      await screen.findByRole('button', { name: 'Cancel offer to Cabin' })
      release()

      await screen.findByRole('button', { name: 'End share with Lake House' })
      expect(screen.getByRole('button', { name: 'Cancel offer to Cabin' })).toBeEnabled()
    })

    it('shouldShowAnOfferAsSharedWhenAReadSentBeforeItsAcceptanceAnswers', async () => {
      const { held, socket, release } = await openWithAReadOnItsWay([share()])

      held.shares = held.shares.map((listed) =>
        listed.id === SHARE_ID ? share({ status: 'ACTIVE' }) : listed,
      )
      socket.publish(
        'ProfileShareChanged',
        shareChanged(SHARE_ID, changedShare({ status: 'ACTIVE' })),
      )
      await screen.findByRole('button', { name: 'End share with Cabin' })
      release()

      await screen.findByRole('button', { name: 'End share with Lake House' })
      expect(screen.getByRole('button', { name: 'End share with Cabin' })).toBeEnabled()
      expect(screen.queryByRole('button', { name: 'Cancel offer to Cabin' })).toBeNull()
    })
  })
})
