import { screen, waitFor, within } from '@testing-library/react'
import { delay, graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { SharedWithHouseholdQuery, VisitorDevicesQuery } from '../graphql/generated/graphql'
import { answersInTurn, answerWith, failsOnceThen } from '../test/graphqlResponses'
import { HOUSEHOLD_ID, meFixture, PROFILE_ID } from '../test/meFixture'
import { renderAppAt } from '../test/render'
import { leaveForHomeAndReturn, type SettingsPage } from '../test/returnVisits'
import { server } from '../test/server'

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

function serve(shares: ShareNode[] = [], devices: DeviceNode[] = []) {
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

// Answers each read of the shares with the next list, and the last list from then on.
function serveSharesInTurn(...lists: ShareNode[][]) {
  serve()
  const handler = answersInTurn(...lists.map((shares) => answerWith(sharesData(shares))))
  server.use(graphql.query('SharedWithHousehold', handler.resolver))
  return handler
}

function serveDevicesInTurn(...lists: DeviceNode[][]) {
  serve()
  const handler = answersInTurn(...lists.map((devices) => answerWith(devicesData(devices))))
  server.use(graphql.query('VisitorDevices', handler.resolver))
  return handler
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
  it('shouldOpenSharedWithUsAsASectionOfHouseholdSettingsAfterShareCodes', async () => {
    serve()
    renderAppAt(VISITORS)

    const menu = await screen.findByRole('navigation', { name: 'Household settings' })
    expect(
      within(menu)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Share offers', 'Share codes', 'Shared with us'])
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

  it('shouldListEachProfileSharedHereWithWhoSharedItAndWhatItIs', async () => {
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

  it('shouldSayWhatStopsBeforeItEndsTheShareOfAProfile', async () => {
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

  it('shouldEndTheShareAndSaySoWhenTheAdminConfirms', async () => {
    const shares = serveSharesInTurn([share()], [])
    server.use(
      graphql.mutation('EndProfileShare', ({ variables }) => {
        expect(variables).toEqual({ input: { shareId: SHARE_ID } })
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
    expect(shares.calls).toBe(2)
    expect(screen.getByRole('heading', { level: 1, name: 'Shared with us' })).toHaveFocus()
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

  it('shouldOfferNoEndForAShareThatAccountMembershipRequires', async () => {
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

  it('shouldSayWhatUnlinkingDoesBeforeItUnlinksATv', async () => {
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
    const devices = serveDevicesInTurn([device()], [])
    server.use(
      graphql.mutation('RevokeDeviceRegistration', ({ variables }) => {
        expect(variables).toEqual({ input: { registrationId: DEVICE_ID } })
        return HttpResponse.json({ data: revokedPayload() })
      }),
    )
    const { user } = renderAppAt(VISITORS)

    await user.click(await screen.findByRole('button', { name: 'Unlink Living room TV' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Unlink' }))

    await noticed('Living room TV unlinked.')
    expect(await screen.findByText('No visitor has linked a TV here.')).toBeVisible()
    expect(devices.calls).toBe(2)
    expect(screen.getByRole('heading', { level: 1, name: 'Shared with us' })).toHaveFocus()
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
    serve()
    const shares = answersInTurn(answerWith(sharesData()), answerWith(sharesData([share()])))
    const devices = answersInTurn(answerWith(devicesData()), answerWith(devicesData([device()])))
    server.use(
      graphql.query('SharedWithHousehold', shares.resolver),
      graphql.query('VisitorDevices', devices.resolver),
    )
    const { user } = renderAppAt(VISITORS)
    await screen.findByText('No visitor has linked a TV here.')

    await leaveForHomeAndReturn(user, SHARED_WITH_US)

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
    ['SharedWithHousehold', "Couldn't load the Profiles shared here."],
    ['VisitorDevices', "Couldn't load the TVs linked here."],
  ])('shouldRetryWhenAListFailsToLoad(%s)', async (operationName, failure) => {
    serve([share()], [device()])
    const data =
      operationName === 'VisitorDevices' ? devicesData([device()]) : sharesData([share()])
    const list = failsOnceThen(data)
    server.use(graphql.query(operationName, list.resolver))
    const { user } = renderAppAt(VISITORS)

    expect(await screen.findByRole('alert')).toHaveTextContent(failure)

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(list.calls).toBe(2)
    expect(screen.getByRole('button', { name: 'End share of Alex' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Unlink Living room TV' })).toBeEnabled()
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
