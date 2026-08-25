import { screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/render'
import { server } from '../test/server'
import { LinkDevice } from './LinkDevice'

const LOOKUP = '/api/auth/device/authorizations/lookup'
const DECISION = '/api/auth/device/authorizations/decision'

const HOME = { id: '22222222-2222-2222-2222-222222222222', name: 'Smith Family' }
const CABIN = { id: '55555555-5555-5555-5555-555555555555', name: 'Cabin' }

const PENDING = {
  userCode: 'BCDF-GHJK',
  deviceName: 'Living Room Apple TV',
  status: 'PENDING',
  requestedAt: '2026-08-03T12:00:00Z',
  households: [HOME],
}

function lookupReturns(body: object, status = 200) {
  server.use(http.post(LOOKUP, () => HttpResponse.json(body, { status })))
}

function decisionReturns(body: object, status = 200, headers?: Record<string, string>) {
  server.use(http.post(DECISION, () => HttpResponse.json(body, { status, headers })))
}

async function enterCode(user: ReturnType<typeof import('@testing-library/user-event').default.setup>, code = 'bcdf-ghjk') {
  // Frame 13: lookup runs on the last character — typing the code is the whole gesture.
  await user.type(screen.getByLabelText(/pairing code/i), code)
}

describe('LinkDevice', () => {
  it('shouldShowRequestingDeviceBeforeOfferingAChoice', async () => {
    lookupReturns(PENDING)
    const { user } = renderWithProviders(<LinkDevice />)

    await enterCode(user)

    expect(await screen.findByText(/living room apple tv/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument()
  })

  it('shouldSendTheNormalizedCodeTheServerReturned', async () => {
    lookupReturns(PENDING)
    let sent: unknown
    server.use(
      http.post(DECISION, async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({ status: 'APPROVED', deviceName: PENDING.deviceName })
      }),
    )
    const { user } = renderWithProviders(<LinkDevice />)

    await enterCode(user, 'bcdf ghjk')
    await user.click(await screen.findByRole('button', { name: /approve/i }))

    await waitFor(() =>
      expect(sent).toEqual({ userCode: 'BCDF-GHJK', decision: 'APPROVE', householdId: HOME.id }),
    )
  })

  it('shouldConfirmApprovalAndRemoveTheChoice', async () => {
    lookupReturns(PENDING)
    decisionReturns({ status: 'APPROVED', deviceName: PENDING.deviceName })
    const { user } = renderWithProviders(<LinkDevice />)

    await enterCode(user)
    await user.click(await screen.findByRole('button', { name: /approve/i }))

    expect(await screen.findByText(/was approved/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })

  it('shouldReportDenialAsItsOwnOutcome', async () => {
    lookupReturns(PENDING)
    decisionReturns({ status: 'DENIED', deviceName: PENDING.deviceName })
    const { user } = renderWithProviders(<LinkDevice />)

    await enterCode(user)
    await user.click(await screen.findByRole('button', { name: /deny/i }))

    expect(await screen.findByText(/was denied/i)).toBeInTheDocument()
    expect(screen.getByText(/not signed in/i)).toBeInTheDocument()
  })

  it('shouldNotOfferAChoiceForAnAlreadyDecidedRequest', async () => {
    lookupReturns({ ...PENDING, status: 'CONSUMED' })
    const { user } = renderWithProviders(<LinkDevice />)

    await enterCode(user)

    expect(await screen.findByText(/already signed in/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })

  it('shouldStillSayWhatHappenedForAStatusItDoesNotKnow', async () => {
    lookupReturns({ ...PENDING, status: 'EXPIRED' })
    const { user } = renderWithProviders(<LinkDevice />)

    await enterCode(user)

    // Unknown members are expected input; an outcome with no sentence is not an outcome.
    expect(await screen.findByRole('button', { name: /link another device/i })).toBeInTheDocument()
    expect(screen.getByRole('status').textContent?.trim()).not.toBe('')
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })

  it('shouldShowTheAuthoritativeOutcomeWhenTheDecisionRacesAnother', async () => {
    lookupReturns(PENDING)
    decisionReturns({ code: 'DEVICE_CODE_NOT_PENDING' }, 409)
    const { user } = renderWithProviders(<LinkDevice />)
    await enterCode(user)

    // The 409 loses to whoever decided first; re-read rather than inviting a blind resubmit.
    lookupReturns({ ...PENDING, status: 'DENIED' })
    await user.click(await screen.findByRole('button', { name: /approve/i }))

    expect(await screen.findByText(/was denied/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })

  it('shouldExplainAnUnknownOrExpiredCode', async () => {
    lookupReturns({ code: 'DEVICE_CODE_NOT_FOUND' }, 404)
    const { user } = renderWithProviders(<LinkDevice />)

    await enterCode(user)

    expect(await screen.findByText(/no pairing request matches/i)).toBeInTheDocument()
  })

  it('shouldExplainAMalformedCode', async () => {
    lookupReturns({ code: 'INVALID_USER_CODE' }, 400)
    const { user } = renderWithProviders(<LinkDevice />)

    await enterCode(user, 'nopenope')

    expect(await screen.findByText(/doesn't look like a pairing code/i)).toBeInTheDocument()
  })

  it('shouldExplainAnExpiredCodeAtDecisionTime', async () => {
    lookupReturns(PENDING)
    decisionReturns({ code: 'DEVICE_CODE_EXPIRED' }, 400)
    const { user } = renderWithProviders(<LinkDevice />)

    await enterCode(user)
    await user.click(await screen.findByRole('button', { name: /approve/i }))

    expect(await screen.findByText(/that code expired/i)).toBeInTheDocument()
  })

  it('shouldSayHowLongToWaitWhenThrottled', async () => {
    server.use(
      http.post(LOOKUP, () =>
        HttpResponse.json({ code: 'TOO_MANY_ATTEMPTS' }, { status: 429, headers: { 'Retry-After': '120' } }),
      ),
    )
    const { user } = renderWithProviders(<LinkDevice />)

    await enterCode(user)

    expect(await screen.findByText(/try again in about 2 minutes/i)).toBeInTheDocument()
  })

  it('shouldBounceToSignInCarryingTheCodeWhenTheSessionExpired', async () => {
    lookupReturns({ code: 'AUTHENTICATION_REQUIRED' }, 401)
    const onUnauthenticated = vi.fn()
    const { user } = renderWithProviders(<LinkDevice onUnauthenticated={onUnauthenticated} />)

    await enterCode(user)

    await waitFor(() => expect(onUnauthenticated).toHaveBeenCalledWith('BCDFGHJK'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldPrefillWithoutSubmittingWhenACodeArrivesInTheUrl', async () => {
    let lookups = 0
    server.use(
      http.post(LOOKUP, () => {
        lookups += 1
        return HttpResponse.json(PENDING)
      }),
    )
    renderWithProviders(<LinkDevice initialCode="BCDF-GHJK" />)

    // The field carries the normalized eight characters; the boxes draw the group separator.
    expect(await screen.findByLabelText(/pairing code/i)).toHaveValue('BCDFGHJK')
    expect(lookups).toBe(0)
  })

  it('shouldAnnounceOutcomesInALiveRegion', async () => {
    lookupReturns(PENDING)
    decisionReturns({ status: 'APPROVED', deviceName: PENDING.deviceName })
    const { user } = renderWithProviders(<LinkDevice />)

    await enterCode(user)
    await user.click(await screen.findByRole('button', { name: /approve/i }))

    const status = await screen.findByRole('status')
    await waitFor(() => expect(status).toHaveTextContent(/was approved/i))
  })

  it('shouldDemandAHouseholdChoiceWhenMoreThanOneIsUsable', async () => {
    lookupReturns({ ...PENDING, households: [HOME, CABIN] })
    let sent: unknown
    server.use(
      http.post(DECISION, async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({ status: 'APPROVED', deviceName: PENDING.deviceName })
      }),
    )
    const { user } = renderWithProviders(<LinkDevice />)

    await enterCode(user)

    // No preselection with two Households: Approve stays locked until one is chosen.
    const approve = await screen.findByRole('button', { name: /approve/i })
    expect(approve).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'Cabin' }))
    await user.click(approve)

    await waitFor(() =>
      expect(sent).toEqual({
        userCode: 'BCDF-GHJK',
        decision: 'APPROVE',
        householdId: CABIN.id,
      }),
    )
  })

  it('shouldExplainABlockedDevice', async () => {
    lookupReturns(PENDING)
    decisionReturns({ code: 'ESN_BLOCKED' }, 403)
    const { user } = renderWithProviders(<LinkDevice />)

    await enterCode(user)
    await user.click(await screen.findByRole('button', { name: /approve/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That device is blocked and cannot be linked.',
    )
  })
})
