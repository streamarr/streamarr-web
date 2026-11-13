import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  SharedWithHouseholdDocument,
  type SharedWithHouseholdQuery,
  type VisitorDevicesQuery,
} from '../graphql/generated/graphql'
import { focusesOf, leaveTheConfirmation, type WayOut } from '../test/focus'
import {
  answersInTurn,
  answerWith,
  comeBackOnline,
  comeBackOnlineUntil,
  failsOnceThen,
  heldAnswer,
  readsThatCanBeHeld,
  serverFailure,
} from '../test/graphqlResponses'
import { serveGraphqlSocket } from '../test/graphqlSocket'
import { HOUSEHOLD_ID, meFixture, PROFILE_ID } from '../test/meFixture'
import { renderAppAt, renderWithProviders } from '../test/render'
import {
  leaveForHome,
  leaveForHomeAndReturn,
  returnThroughTheProfileMenu,
  type SettingsPage,
} from '../test/returnVisits'
import { server } from '../test/server'
import {
  followingShareChanges,
  HIDDEN_ONCE_OVER,
  liveShare,
  shareChanged,
} from '../test/shareChangeFixtures'
import { SharedWithUsScreen } from './SharedWithUsScreen'

type ShareFields = SharedWithHouseholdQuery['householdShares']['edges'][number]['node']
type SharedProfile = NonNullable<ShareFields['profile']> & { __typename: 'ProfileSummary' }
type ShareNode = Omit<ShareFields, 'profile'> & {
  __typename: 'ProfileShare'
  profile: SharedProfile | null
}
type DeviceNode = VisitorDevicesQuery['householdDevices']['edges'][number]['node'] & {
  __typename: 'DeviceRegistrationDetails'
}

const VISITORS = '/settings/household/visitors'
const SHARED_WITH_US: SettingsPage = {
  area: 'Household settings',
  heading: 'Shared with us',
  section: 'Shared with us',
}
const SHARE_ID = '77777777-7777-7777-7777-777777777777'
const DEVICE_ID = '66666666-6666-6666-6666-666666666666'

function sharedProfile(overrides: Partial<SharedProfile> = {}): SharedProfile {
  return {
    __typename: 'ProfileSummary',
    id: PROFILE_ID,
    name: 'Alex',
    picture: null,
    kind: 'ADULT',
    personalProfile: false,
    restricted: false,
    ...overrides,
  }
}

function share(overrides: Partial<ShareNode> = {}): ShareNode {
  return {
    __typename: 'ProfileShare',
    id: SHARE_ID,
    profileId: PROFILE_ID,
    householdId: HOUSEHOLD_ID,
    status: 'ACTIVE',
    requiredByAccountMembership: false,
    profile: sharedProfile(),
    offeredByDisplayName: 'Sam',
    visitor: true,
    ...overrides,
  }
}

function device(overrides: Partial<DeviceNode> = {}): DeviceNode {
  return {
    __typename: 'DeviceRegistrationDetails',
    id: DEVICE_ID,
    householdId: HOUSEHOLD_ID,
    displayName: 'Living room TV',
    authorizingAccountDisplayName: 'Sam',
    status: 'ACTIVE',
    // Midday, so that the day reads the same in every time zone.
    pairedAt: '2026-11-11T12:00:00Z',
    ...overrides,
  }
}

function sharesData(shares: ShareNode[] = []) {
  return {
    householdShares: {
      __typename: 'ProfileShareConnection',
      edges: shares.map((node) => ({ __typename: 'ProfileShareEdge', node })),
    },
  }
}

function devicesData(devices: DeviceNode[] = []) {
  return {
    householdDevices: {
      __typename: 'DeviceRegistrationConnection',
      edges: devices.map((node) => ({ __typename: 'DeviceRegistrationEdge', node })),
    },
  }
}

// The server's shares and TVs at each read: a test changes them where the server would. The page
// reads them again once it follows share changes, so no test counts on how often it reads.
function serve(shares: ShareNode[] = [], devices: DeviceNode[] = []) {
  const socket = serveGraphqlSocket()
  serveLists(shares, devices)
  return socket
}

// The same lists with no socket of live changes, so that only the page's own reads change them.
function serveLists(shares: ShareNode[], devices: DeviceNode[]) {
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: meFixture() } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    // Household settings open on Share offers, the way back to this page.
    graphql.query('ShareOffers', () => HttpResponse.json({ data: sharesData() })),
    graphql.query('SharedWithHousehold', ({ variables }) => {
      expect(variables).toEqual({ householdId: HOUSEHOLD_ID })
      return HttpResponse.json({ data: sharesData(shares) })
    }),
    graphql.query('VisitorDevices', ({ variables }) => {
      expect(variables).toEqual({ householdId: HOUSEHOLD_ID })
      return HttpResponse.json({ data: devicesData(devices) })
    }),
  )
}

function sharesRegion() {
  return screen.findByRole('region', { name: 'Profiles shared with Smith Family' })
}

function devicesRegion() {
  return screen.findByRole('region', { name: 'TVs linked by visitors' })
}

function endRefused(typename: string, message: string) {
  return {
    endProfileShare: {
      __typename: 'EndProfileSharePayload',
      share: null,
      userErrors: [{ __typename: typename, message }],
    },
  }
}

function unlinkRefused(typename: string, message: string) {
  return {
    revokeDeviceRegistration: {
      __typename: 'RevokeDeviceRegistrationPayload',
      registrationId: null,
      userErrors: [{ __typename: typename, message }],
    },
  }
}

describe('Shared with us', () => {
  it('shouldListSharedWithUsAfterShareCodesWhenHouseholdSettingsOpen', async () => {
    serve()
    renderAppAt(VISITORS)

    const menu = await screen.findByRole('navigation', { name: 'Household settings' })
    expect(
      within(menu)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Share invitations', 'Share codes', 'Shared with us'])
    expect(within(menu).getByRole('link', { name: 'Shared with us' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      await within(screen.getByRole('region', { name: 'Shared with us' })).findByRole('heading', {
        level: 1,
        name: 'Shared with us',
      }),
    ).toBeVisible()
  })

  it('shouldSayInOneSentenceWhenNothingIsSharedOrLinkedHere', async () => {
    serve()
    renderAppAt(VISITORS)

    expect(
      within(await sharesRegion()).getByText(
        'No Profile from another Household is shared with Smith Family.',
      ),
    ).toBeVisible()
    expect(
      within(await devicesRegion()).getByText('No visitor has linked a TV here.'),
    ).toBeVisible()
  })

  it('shouldShowWhoSharedEachProfileAndWhatItIsWhenProfilesAreSharedHere', async () => {
    serve([
      share({ profile: sharedProfile({ personalProfile: true, restricted: true }) }),
      share({
        id: 'b',
        profile: sharedProfile({ id: 'robin', name: 'Robin' }),
        offeredByDisplayName: null,
      }),
      share({ id: 'c', profile: null }),
    ])
    renderAppAt(VISITORS)

    const [alex, robin, ...rest] = await within(await sharesRegion()).findAllByRole('listitem')
    expect(rest).toEqual([])
    expect(within(alex).getByText('Alex')).toBeVisible()
    expect(within(alex).getByText('Shared by Sam')).toBeVisible()
    expect(within(alex).getByText('Personal Profile')).toBeVisible()
    expect(within(alex).getByText('Restricted')).toBeVisible()
    expect(within(robin).getByText('Robin')).toBeVisible()
    expect(within(robin).queryByText(/^Shared by/)).not.toBeInTheDocument()
    expect(within(robin).queryByText('Personal Profile')).not.toBeInTheDocument()
  })

  it('shouldSayWhatStopsBeforeEndingTheShareWhenTheAdminEndsTheShareOfAProfile', async () => {
    serve([share()])
    let ended = false
    server.use(
      graphql.mutation('EndProfileShare', () => {
        ended = true
        return HttpResponse.json({ data: { endProfileShare: endedPayload() } })
      }),
    )
    const { user } = renderAppAt(VISITORS)

    await user.click(await screen.findByRole('button', { name: 'End share of Alex' }))

    const dialog = screen.getByRole('dialog', { name: 'End the share of Alex?' })
    expect(dialog).toHaveTextContent(
      'Alex stops being available in Smith Family, and anyone using it here returns to the Profile picker.',
    )
    expect(dialog).not.toHaveTextContent('TV')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(ended).toBe(false)
  })

  it('shouldSayThePersonLosesTheHouseholdAndTheirTvsWhenItIsTheirPersonalProfile', async () => {
    serve([share({ profile: sharedProfile({ personalProfile: true }) })])
    const { user } = renderAppAt(VISITORS)

    await user.click(await screen.findByRole('button', { name: 'End share of Alex' }))

    expect(screen.getByRole('dialog')).toHaveTextContent(
      "This is someone's Personal Profile, so that person can no longer use Smith Family, and the TVs they linked here are unlinked.",
    )
  })

  it.each<[string, WayOut]>([
    ['End share of Alex', 'Cancel'],
    ['End share of Alex', 'Escape'],
    ['Unlink Living room TV', 'Cancel'],
    ['Unlink Living room TV', 'Escape'],
  ])(
    'shouldReturnFocusToTheActionWhenTheAdminLeavesItsConfirmation(%s, %s)',
    async (action, way) => {
      serve([share()], [device()])
      const { user } = renderAppAt(VISITORS)
      const trigger = await screen.findByRole('button', { name: action })
      const heading = focusesOf(screen.getByRole('heading', { level: 1, name: 'Shared with us' }))

      await user.click(trigger)
      await leaveTheConfirmation(user, way)

      await waitFor(() => expect(trigger).toHaveFocus())
      expect(heading.count).toBe(0)
    },
  )

  it('shouldEndTheShareAndSaySoWhenTheAdminConfirms', async () => {
    const shares = [share()]
    serve(shares)
    server.use(
      graphql.mutation('EndProfileShare', ({ variables }) => {
        expect(variables).toEqual({ input: { shareId: SHARE_ID } })
        shares.splice(0)
        return HttpResponse.json({ data: { endProfileShare: endedPayload() } })
      }),
    )
    const { user } = renderAppAt(VISITORS)

    await user.click(await screen.findByRole('button', { name: 'End share of Alex' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End share' }))

    await noticed('Sharing of Alex ended.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      await screen.findByText('No Profile from another Household is shared with Smith Family.'),
    ).toBeVisible()
    expect(screen.getByRole('heading', { level: 1, name: 'Shared with us' })).toHaveFocus()
  })

  it('shouldTakeThePersonsTvsOffTheListWhenTheShareOfTheirPersonalProfileEnds', async () => {
    const alexsTv = device({ authorizingAccountDisplayName: 'Alex' })
    const robinsTv = device({
      id: 'b',
      displayName: 'Den TV',
      authorizingAccountDisplayName: 'Robin',
    })
    // The server unlinks the TVs that Alex linked here when the share of Alex's Personal Profile
    // ends (ADR 0024), and leaves the TVs of other visitors linked.
    let ended = false
    serve()
    server.use(
      graphql.query('SharedWithHousehold', () =>
        HttpResponse.json({
          data: sharesData(
            ended ? [] : [share({ profile: sharedProfile({ personalProfile: true }) })],
          ),
        }),
      ),
      graphql.query('VisitorDevices', () =>
        HttpResponse.json({ data: devicesData(ended ? [robinsTv] : [alexsTv, robinsTv]) }),
      ),
      graphql.mutation('EndProfileShare', () => {
        ended = true
        return HttpResponse.json({ data: { endProfileShare: endedPayload() } })
      }),
    )
    const { user } = renderAppAt(VISITORS)
    const tvs = await devicesRegion()
    await within(tvs).findByRole('button', { name: 'Unlink Living room TV' })

    await user.click(await screen.findByRole('button', { name: 'End share of Alex' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End share' }))
    await noticed('Sharing of Alex ended.')

    await waitFor(() =>
      expect(
        within(tvs).queryByRole('button', { name: 'Unlink Living room TV' }),
      ).not.toBeInTheDocument(),
    )
    expect(within(tvs).getByRole('button', { name: 'Unlink Den TV' })).toBeEnabled()
  })

  it('shouldTakeTheEndedShareOffTheListWhenAReadFromBeforeTheEndIsOnItsWay', async () => {
    const fromBefore = heldAnswer(sharesData([share()]))
    serve()
    const shares = answersInTurn(
      answerWith(sharesData([share()])),
      fromBefore.answer,
      answerWith(sharesData([])),
    )
    const devices = answersInTurn(answerWith(devicesData()))
    server.use(
      graphql.query('SharedWithHousehold', shares.resolver),
      graphql.query('VisitorDevices', devices.resolver),
      graphql.mutation('EndProfileShare', () =>
        HttpResponse.json({ data: { endProfileShare: endedPayload() } }),
      ),
    )
    const { user } = renderAppAt(VISITORS)
    const endAlex = await screen.findByRole('button', { name: 'End share of Alex' })
    comeBackOnline()
    await waitFor(() => expect(shares.calls).toBe(2))

    await user.click(endAlex)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End share' }))
    // The page reads the TVs again, and the shares too, once the server takes the end. So the read
    // of the shares after the end has started by the time the server sees the third read of TVs.
    await waitFor(() => expect(devices.calls).toBe(3))
    fromBefore.release()

    await noticed('Sharing of Alex ended.')
    expect(
      await screen.findByText('No Profile from another Household is shared with Smith Family.'),
    ).toBeVisible()
    expect(shares.calls).toBe(3)
  })

  it('shouldReadTheTvsAgainWhenTheAdminEndsTheShareOfSomeonesPersonalProfile', async () => {
    const shares = [share({ profile: sharedProfile({ personalProfile: true }) })]
    const tvs = [device()]
    serveLists(shares, tvs)
    server.use(
      graphql.mutation('EndProfileShare', () => {
        // The server unlinks the TVs that the person linked here as it ends the share.
        shares.splice(0)
        tvs.splice(0)
        return HttpResponse.json({ data: { endProfileShare: endedPayload() } })
      }),
    )
    const { user } = renderAppAt(VISITORS)
    await screen.findByRole('button', { name: 'Unlink Living room TV' })

    await user.click(await screen.findByRole('button', { name: 'End share of Alex' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End share' }))

    await noticed('Sharing of Alex ended.')
    expect(await screen.findByText('No visitor has linked a TV here.')).toBeVisible()
  })

  it('shouldHoldBackConfirmingAnotherEndShareWhenTheSharesAreStillBeingReadAgain', async () => {
    const mara = share({
      id: '77777777-7777-7777-7777-777777777778',
      profile: sharedProfile({ id: '22222222-2222-2222-2222-222222222223', name: 'Mara' }),
    })
    const shares = [share(), mara]
    serveLists(shares, [])
    const reads = readsThatCanBeHeld(() => sharesData(shares))
    server.use(
      graphql.query('SharedWithHousehold', reads.resolver),
      graphql.mutation('EndProfileShare', () => {
        shares.splice(0, 1)
        return HttpResponse.json({ data: { endProfileShare: endedPayload() } })
      }),
    )
    const { user } = renderAppAt(VISITORS)
    await user.click(await screen.findByRole('button', { name: 'End share of Alex' }))
    const reread = reads.holdNext()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End share' }))
    await reread.arrived
    await noticed('Sharing of Alex ended.')

    await user.click(screen.getByRole('button', { name: 'End share of Mara' }))
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'End share' })
    expect(confirm).toBeDisabled()
    reread.release()
    await waitFor(() => expect(confirm).toBeEnabled())
  })

  it('shouldKeepTheConfirmationOpenWithTheServersWordsWhenEndingIsRefused', async () => {
    serve([share()])
    server.use(
      graphql.mutation('EndProfileShare', () =>
        HttpResponse.json({
          data: endRefused('ShareNotActiveError', 'That share is not active.'),
        }),
      ),
    )
    const { user } = renderAppAt(VISITORS)

    await user.click(await screen.findByRole('button', { name: 'End share of Alex' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'End share' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^That share is not active\.$/,
    )
    expect(within(dialog).getByRole('button', { name: 'End share' })).toBeEnabled()
  })

  it('shouldOfferNoEndWhenAccountMembershipRequiresTheShare', async () => {
    serve([share({ requiredByAccountMembership: true })])
    renderAppAt(VISITORS)

    const row = await within(await sharesRegion()).findByRole('listitem')
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  })

  it('shouldListEachTvLinkedByAVisitorWithWhoLinkedItAndWhen', async () => {
    serve(
      [],
      [device(), device({ id: 'b', displayName: 'Den TV', authorizingAccountDisplayName: null })],
    )
    renderAppAt(VISITORS)

    const [living, den] = await within(await devicesRegion()).findAllByRole('listitem')
    expect(within(living).getByText('Living room TV')).toBeVisible()
    expect(within(living).getByText('Linked by Sam')).toBeVisible()
    expect(within(living).getByText('Nov 11, 2026')).toBeVisible()
    expect(within(den).getByText('Linked by a deleted Account')).toBeVisible()
  })

  it('shouldSayWhatUnlinkingDoesBeforeUnlinkingWhenTheAdminUnlinksATv', async () => {
    serve([], [device()])
    let revoked = false
    server.use(
      graphql.mutation('RevokeDeviceRegistration', () => {
        revoked = true
        return HttpResponse.json({ data: revokedPayload() })
      }),
    )
    const { user } = renderAppAt(VISITORS)

    await user.click(await screen.findByRole('button', { name: 'Unlink Living room TV' }))

    const dialog = screen.getByRole('dialog', { name: 'Unlink Living room TV?' })
    expect(dialog).toHaveTextContent(
      'Living room TV is signed out of Smith Family. It must be linked again before it can be used here.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(revoked).toBe(false)
  })

  it('shouldUnlinkTheTvAndSaySoWhenTheAdminConfirms', async () => {
    const tvs = [device()]
    serve([], tvs)
    server.use(
      graphql.mutation('RevokeDeviceRegistration', ({ variables }) => {
        expect(variables).toEqual({ input: { registrationId: DEVICE_ID } })
        tvs.splice(0)
        return HttpResponse.json({ data: revokedPayload() })
      }),
    )
    const { user } = renderAppAt(VISITORS)

    await user.click(await screen.findByRole('button', { name: 'Unlink Living room TV' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Unlink' }))

    await noticed('Living room TV unlinked.')
    expect(await screen.findByText('No visitor has linked a TV here.')).toBeVisible()
    expect(screen.getByRole('heading', { level: 1, name: 'Shared with us' })).toHaveFocus()
  })

  it('shouldTakeATvUnlinkedElsewhereOffTheListWhenAReadFromBeforeTheRefusedUnlinkIsOnItsWay', async () => {
    const fromBefore = heldAnswer(devicesData([device()]))
    serve()
    const devices = answersInTurn(
      answerWith(devicesData([device()])),
      fromBefore.answer,
      answerWith(devicesData([])),
    )
    server.use(
      graphql.query('VisitorDevices', devices.resolver),
      graphql.mutation('RevokeDeviceRegistration', () =>
        HttpResponse.json({
          data: unlinkRefused('RegistrationNotActiveError', 'That TV is no longer linked.'),
        }),
      ),
    )
    const { user } = renderAppAt(VISITORS)
    const unlink = await screen.findByRole('button', { name: 'Unlink Living room TV' })
    comeBackOnline()
    await waitFor(() => expect(devices.calls).toBe(2))

    await user.click(unlink)
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Unlink' }))
    // The refusal shows once the server answers. By then the read after the refusal has started.
    await within(dialog).findByRole('alert')
    fromBefore.release()

    expect(await screen.findByText('No visitor has linked a TV here.')).toBeVisible()
    expect(devices.calls).toBe(3)
  })

  it('shouldHoldBackConfirmingAnotherUnlinkWhenTheTvsAreStillBeingReadAgain', async () => {
    const bedroom = device({
      id: '66666666-6666-6666-6666-666666666667',
      displayName: 'Bedroom TV',
    })
    const tvs = [device(), bedroom]
    serveLists([], tvs)
    const reads = readsThatCanBeHeld(() => devicesData(tvs))
    server.use(
      graphql.query('VisitorDevices', reads.resolver),
      graphql.mutation('RevokeDeviceRegistration', () => {
        tvs.splice(0, 1)
        return HttpResponse.json({ data: revokedPayload() })
      }),
    )
    const { user } = renderAppAt(VISITORS)
    await user.click(await screen.findByRole('button', { name: 'Unlink Living room TV' }))
    const reread = reads.holdNext()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Unlink' }))
    await reread.arrived
    await noticed('Living room TV unlinked.')

    await user.click(screen.getByRole('button', { name: 'Unlink Bedroom TV' }))
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Unlink' })
    expect(confirm).toBeDisabled()
    reread.release()
    await waitFor(() => expect(confirm).toBeEnabled())
  })

  it('shouldKeepTheConfirmationOpenWithTheServersWordsWhenUnlinkingIsRefused', async () => {
    serve([], [device()])
    server.use(
      graphql.mutation('RevokeDeviceRegistration', () =>
        HttpResponse.json({
          data: unlinkRefused('RegistrationNotActiveError', 'That TV is no longer linked.'),
        }),
      ),
    )
    const { user } = renderAppAt(VISITORS)

    await user.click(await screen.findByRole('button', { name: 'Unlink Living room TV' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Unlink' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /^That TV is no longer linked\.$/,
    )
  })

  it('shouldShowWhatWasSharedAndLinkedWhileTheAdminWasAwayWhenTheyReturn', async () => {
    const shares: ShareNode[] = []
    const tvs: DeviceNode[] = []
    serve(shares, tvs)
    const { user } = renderAppAt(VISITORS)
    await screen.findByText('No visitor has linked a TV here.')

    await leaveForHome(user, SHARED_WITH_US)
    shares.push(share())
    tvs.push(device())
    await returnThroughTheProfileMenu(user, SHARED_WITH_US)

    expect(await screen.findByRole('button', { name: 'End share of Alex' })).toBeEnabled()
    expect(await screen.findByRole('button', { name: 'Unlink Living room TV' })).toBeEnabled()
  })

  it('shouldShowBothListsAsLoadingUntilTheServerAnswersWhenTheAdminReturns', async () => {
    serve()
    const { user } = renderAppAt(VISITORS)
    await screen.findByText('No visitor has linked a TV here.')
    server.use(
      graphql.query('SharedWithHousehold', () => delay('infinite')),
      graphql.query('VisitorDevices', () => delay('infinite')),
    )

    await leaveForHomeAndReturn(user, SHARED_WITH_US)

    expect(await screen.findByRole('status', { name: 'Loading shared Profiles' })).toBeVisible()
    expect(screen.getByRole('status', { name: 'Loading linked TVs' })).toBeVisible()
  })

  it.each([
    [
      'SharedWithHousehold',
      "Couldn't load the Profiles shared here.",
      'Profiles shared with Smith Family',
    ],
    ['VisitorDevices', "Couldn't load the TVs linked here.", 'TVs linked by visitors'],
  ])(
    'shouldSayWhyInItsSectionAndRetryWhenAListFailsToLoad(%s)',
    async (operationName, failure, title) => {
      serve([share()], [device()])
      const data =
        operationName === 'VisitorDevices' ? devicesData([device()]) : sharesData([share()])
      const list = failsOnceThen(data)
      server.use(graphql.query(operationName, list.resolver))
      // Rendered alone, so that only Retry reads the list again.
      const { user } = renderWithProviders(<SharedWithUsScreen />)

      const section = await screen.findByRole('region', { name: title })
      expect(await within(section).findByRole('alert')).toHaveTextContent(failure)
      // The page loaded, so only the section offers a way back: Retry, and no way out.
      expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()

      await user.click(within(section).getByRole('button', { name: 'Retry' }))

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
      expect(list.calls).toBe(2)
      expect(screen.getByRole('button', { name: 'End share of Alex' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Unlink Living room TV' })).toBeEnabled()
    },
  )
})

describe('Shared with us as shares change elsewhere', () => {
  const robin = liveShare({
    id: '99999999-9999-9999-9999-999999999999',
    profileId: 'robin',
    status: 'ACTIVE',
    profile: sharedProfile({ id: 'robin', name: 'Robin' }),
  })

  // The TVs are the server's list at each read, so a test changes them by changing this list.
  async function openWithAShareOfAlex(tvs: DeviceNode[] = [], alex = share()) {
    const socket = serve([alex], tvs)
    const rendered = renderAppAt(VISITORS)
    await screen.findByRole('button', { name: 'End share of Alex' })
    await followingShareChanges(socket)
    return { socket, ...rendered }
  }

  function sharedNames() {
    return screen
      .getAllByRole('button', { name: /^End share of / })
      .map((end) => end.getAttribute('aria-label'))
  }

  it('shouldListAProfileFirstWhenItIsAcceptedElsewhereWhileThePageIsOpen', async () => {
    const { socket } = await openWithAShareOfAlex()

    socket.publish('ProfileShareChanged', shareChanged(robin.id, robin))

    await waitFor(() => expect(sharedNames()).toEqual(['End share of Robin', 'End share of Alex']))
  })

  it('shouldTakeAShareOutWhenItEndsElsewhere', async () => {
    const { socket } = await openWithAShareOfAlex()

    socket.publish(
      'ProfileShareChanged',
      shareChanged(SHARE_ID, liveShare({ status: 'ENDED', ...HIDDEN_ONCE_OVER })),
    )

    expect(
      await screen.findByText('No Profile from another Household is shared with Smith Family.'),
    ).toBeVisible()
  })

  it('shouldCloseTheConfirmationAndSaySoWhenTheShareEndsElsewhereMeanwhile', async () => {
    const { socket, user } = await openWithAShareOfAlex()
    await user.click(screen.getByRole('button', { name: 'End share of Alex' }))

    socket.publish(
      'ProfileShareChanged',
      shareChanged(SHARE_ID, liveShare({ status: 'ENDED', ...HIDDEN_ONCE_OVER })),
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await noticed('Alex is no longer shared here.')
    expect(screen.getByRole('heading', { level: 1, name: 'Shared with us' })).toHaveFocus()
  })

  it('shouldCloseTheConfirmationAndSaySoWhenTheTvIsUnlinkedElsewhereMeanwhile', async () => {
    const tvs = [device()]
    const { user } = await openWithAShareOfAlex(tvs)
    await user.click(await screen.findByRole('button', { name: 'Unlink Living room TV' }))

    tvs.splice(0)
    comeBackOnline()

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await noticed('Living room TV is no longer linked here.')
    expect(screen.getByRole('heading', { level: 1, name: 'Shared with us' })).toHaveFocus()
  })

  it('shouldMoveFocusToTheHeadingWhenTheShareTheAdminIsOnEndsElsewhere', async () => {
    const { socket } = await openWithAShareOfAlex()
    act(() => screen.getByRole('button', { name: 'End share of Alex' }).focus())

    socket.publish(
      'ProfileShareChanged',
      shareChanged(SHARE_ID, liveShare({ status: 'ENDED', ...HIDDEN_ONCE_OVER })),
    )

    await screen.findByText('No Profile from another Household is shared with Smith Family.')
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Shared with us' })).toHaveFocus(),
    )
  })

  it('shouldReadTheTvsAgainWhenTheShareOfSomeonesPersonalProfileEnds', async () => {
    const tvs = [device()]
    const reads = { count: 0 }
    const socket = serve([share({ profile: sharedProfile({ personalProfile: true }) })])
    server.use(
      graphql.query('VisitorDevices', () => {
        reads.count += 1
        return HttpResponse.json({ data: devicesData(tvs) })
      }),
    )
    renderAppAt(VISITORS)
    await screen.findByRole('button', { name: 'Unlink Living room TV' })
    await followingShareChanges(socket)
    // The first read, and the read that the page makes once it follows share changes.
    await waitFor(() => expect(reads.count).toBeGreaterThanOrEqual(2))
    // The server unlinks the TVs that the person linked here as it ends the share.
    tvs.splice(0)
    const readsBeforeTheEnd = reads.count

    socket.publish(
      'ProfileShareChanged',
      shareChanged(SHARE_ID, liveShare({ status: 'ENDED', ...HIDDEN_ONCE_OVER })),
    )

    expect(await screen.findByText('No visitor has linked a TV here.')).toBeVisible()
    expect(reads.count).toBeGreaterThan(readsBeforeTheEnd)
  })

  it('shouldKeepTheTvsOnScreenWhenTheReadAfterAShareEndsFails', async () => {
    const tvs = { calls: 0, answer: answerWith(devicesData([device()])) }
    const socket = serve([share({ profile: sharedProfile({ personalProfile: true }) })])
    server.use(
      graphql.query('VisitorDevices', () => {
        tvs.calls += 1
        return tvs.answer()
      }),
    )
    renderAppAt(VISITORS)
    const tv = await screen.findByRole('button', { name: 'Unlink Living room TV' })
    await followingShareChanges(socket)
    // The first read, and the read that the page makes once it follows share changes.
    await waitFor(() => expect(tvs.calls).toBeGreaterThanOrEqual(2))
    tvs.answer = serverFailure
    const readsBeforeTheEnd = tvs.calls

    socket.publish(
      'ProfileShareChanged',
      shareChanged(SHARE_ID, liveShare({ status: 'ENDED', ...HIDDEN_ONCE_OVER })),
    )
    await waitFor(() => expect(tvs.calls).toBeGreaterThan(readsBeforeTheEnd))
    // The server unlinked the TV as it ended the share, and its next answer says so.
    const fresh = heldAnswer(devicesData())
    tvs.answer = fresh.answer
    await comeBackOnlineUntil(tvs, tvs.calls + 1)

    expect(tv).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load the TVs linked here.")).not.toBeInTheDocument()
    fresh.release()
    expect(await screen.findByText('No visitor has linked a TV here.')).toBeVisible()
  })

  it('shouldReadTheTvsAgainWhenAPersonalProfilesShareEndsAfterAReadTookItOut', async () => {
    const shares = [
      share({ profile: sharedProfile({ personalProfile: true }) }),
      share({
        id: 'mara',
        profileId: 'mara',
        profile: sharedProfile({ id: 'mara', name: 'Mara' }),
      }),
    ]
    const tvs = [device()]
    const socket = serve(shares, tvs)
    server.use(
      graphql.mutation('EndProfileShare', () => {
        // Alex's share ends elsewhere between the page's reads after ending Mara's: the read of
        // the shares leaves both out, and the read of the TVs still lists Alex's TV.
        shares.splice(0)
        return HttpResponse.json({ data: { endProfileShare: endedPayload() } })
      }),
    )
    const { user } = renderAppAt(VISITORS)
    await screen.findByRole('button', { name: 'Unlink Living room TV' })
    await followingShareChanges(socket)
    await user.click(await screen.findByRole('button', { name: 'End share of Mara' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End share' }))
    await noticed('Sharing of Mara ended.')
    expect(screen.getByRole('button', { name: 'Unlink Living room TV' })).toBeVisible()
    tvs.splice(0)

    socket.publish(
      'ProfileShareChanged',
      shareChanged(SHARE_ID, liveShare({ status: 'ENDED', ...HIDDEN_ONCE_OVER })),
    )

    expect(await screen.findByText('No visitor has linked a TV here.')).toBeVisible()
  })

  it('shouldReadTheTvsAgainWhenAPersonalProfilesShareEndsBeforeThePageShowsTheReadThatListsIt', async () => {
    const leo = share({
      id: 'leo',
      profileId: 'leo',
      profile: sharedProfile({ id: 'leo', name: 'Leo', personalProfile: true }),
    })
    const held = { shares: [share()] }
    const tvs: DeviceNode[] = []
    const socket = serve([], tvs)
    const reads = readsThatCanBeHeld(() => sharesData(held.shares))
    server.use(graphql.query('SharedWithHousehold', reads.resolver))
    const { apolloClient } = renderAppAt(VISITORS)
    await screen.findByRole('button', { name: 'End share of Alex' })
    await followingShareChanges(socket)
    // While the browser is offline, Leo's Personal Profile is shared here and Leo links a TV.
    held.shares = [leo, share()]
    tvs.push(device({ displayName: 'Guest room TV', authorizingAccountDisplayName: 'Leo' }))
    const read = reads.holdNext()
    comeBackOnline()
    await read.arrived
    await screen.findByRole('button', { name: 'Unlink Guest room TV' })
    // Apollo tells the page's query about a cache write a task later. Leo's share ends as soon as
    // the cache holds the answer that lists Leo, so the end arrives before the page has drawn Leo.
    const stopWatching = apolloClient.cache.watch<SharedWithHouseholdQuery>({
      query: SharedWithHouseholdDocument,
      variables: { householdId: HOUSEHOLD_ID },
      optimistic: true,
      callback: ({ result }) => {
        if (!result?.householdShares?.edges?.some((edge) => edge?.node?.id === leo.id)) return
        stopWatching()
        // The server unlinks the TV that Leo linked here as it ends Leo's share.
        held.shares = [share()]
        tvs.splice(0)
        socket.publish(
          'ProfileShareChanged',
          shareChanged(
            leo.id,
            liveShare({ id: leo.id, profileId: 'leo', status: 'ENDED', ...HIDDEN_ONCE_OVER }),
          ),
        )
      },
    })

    read.release()

    expect(await screen.findByText('No visitor has linked a TV here.')).toBeVisible()
    expect(sharedNames()).toEqual(['End share of Alex'])
  })

  it('shouldLeaveOutAProfileOfTheHouseholdsOwnWhenItsShareChanges', async () => {
    const { socket } = await openWithAShareOfAlex()

    socket.publish(
      'ProfileShareChanged',
      shareChanged(
        'own',
        liveShare({ id: 'own', profileId: 'own', visitor: false, status: 'ACTIVE' }),
      ),
    )
    socket.publish('ProfileShareChanged', shareChanged(robin.id, robin))

    await waitFor(() => expect(sharedNames()).toEqual(['End share of Robin', 'End share of Alex']))
  })

  describe('while a read of the shares is on its way', () => {
    const mara = share({
      id: 'mara',
      profileId: 'mara',
      profile: sharedProfile({ id: 'mara', name: 'Mara' }),
    })
    const leo = liveShare({
      id: 'leo',
      profileId: 'leo',
      status: 'ACTIVE',
      profile: sharedProfile({ id: 'leo', name: 'Leo' }),
    })

    // The shares the server holds; each read answers with them as they stood when it arrived.
    async function openWithAReadOnItsWay() {
      const held = { shares: [share()] }
      const socket = serve()
      const reads = readsThatCanBeHeld(() => sharesData(held.shares))
      server.use(graphql.query('SharedWithHousehold', reads.resolver))
      renderAppAt(VISITORS)
      await screen.findByRole('button', { name: 'End share of Alex' })
      await followingShareChanges(socket)
      // Mara's share shows that the held read has answered.
      held.shares = [mara, ...held.shares]
      const read = reads.holdNext()
      comeBackOnline()
      await read.arrived
      return { held, socket, release: read.release }
    }

    it('shouldKeepAProfileAcceptedElsewhereWhenAReadSentBeforeItAnswers', async () => {
      const { held, socket, release } = await openWithAReadOnItsWay()

      held.shares = [leo, ...held.shares]
      socket.publish('ProfileShareChanged', shareChanged(leo.id, leo))
      await screen.findByRole('button', { name: 'End share of Leo' })
      release()

      await screen.findByRole('button', { name: 'End share of Mara' })
      expect(sharedNames()).toEqual(['End share of Leo', 'End share of Mara', 'End share of Alex'])
    })

    it('shouldLeaveOutAShareThatEndedElsewhereWhenAReadSentBeforeItsEndAnswers', async () => {
      const { held, socket, release } = await openWithAReadOnItsWay()

      held.shares = [mara]
      socket.publish(
        'ProfileShareChanged',
        shareChanged(SHARE_ID, liveShare({ status: 'ENDED', ...HIDDEN_ONCE_OVER })),
      )
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'End share of Alex' })).not.toBeInTheDocument(),
      )
      release()

      await screen.findByRole('button', { name: 'End share of Mara' })
      expect(sharedNames()).toEqual(['End share of Mara'])
    })
  })

  it('shouldLeaveAnOfferOutOfSharedWithUsWhenItIsNotYetAccepted', async () => {
    const { socket } = await openWithAShareOfAlex()

    socket.publish('ProfileShareChanged', shareChanged(robin.id, { ...robin, status: 'PENDING' }))
    socket.publish(
      'ProfileShareChanged',
      shareChanged(SHARE_ID, liveShare({ status: 'ENDED', ...HIDDEN_ONCE_OVER })),
    )

    expect(
      await screen.findByText('No Profile from another Household is shared with Smith Family.'),
    ).toBeVisible()
  })
})

function endedPayload() {
  return {
    __typename: 'EndProfileSharePayload',
    share: { __typename: 'ProfileShare', id: SHARE_ID, status: 'ENDED' },
    userErrors: [],
  }
}

function revokedPayload() {
  return {
    revokeDeviceRegistration: {
      __typename: 'RevokeDeviceRegistrationPayload',
      registrationId: DEVICE_ID,
      userErrors: [],
    },
  }
}

// The confirmation holds a status of its own while a request is on its way, so the page's notice
// is the one status only once the confirmation has closed.
async function noticed(text: string) {
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(text))
}
