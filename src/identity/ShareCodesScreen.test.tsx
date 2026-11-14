import { act, screen, waitFor, within } from '@testing-library/react'
import { parse, valueFromASTUntyped, visit } from 'graphql'
import { delay, graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { HouseholdShareCodesQuery } from '../graphql/generated/graphql'
import {
  answersInTurn,
  answerWith,
  comeBackOnline,
  failsOnceThen,
  heldAnswer,
  networkFailure,
} from '../test/graphqlResponses'
import { HOUSEHOLD_ID, meFixture } from '../test/meFixture'
import { renderAppAt, renderWithProviders } from '../test/render'
import { leaveForHomeAndReturn, type SettingsPage } from '../test/returnVisits'
import { server } from '../test/server'
import { SHARE_CODE } from '../test/shareCodeFixtures'
import { ShareCodesScreen } from './ShareCodesScreen'

type ShareCodeNode = HouseholdShareCodesQuery['householdShareCodes']['edges'][number]['node'] & {
  __typename: 'ShareCode'
}

const CODES = '/settings/household/codes'
const SHARE_CODES: SettingsPage = {
  area: 'Household settings',
  heading: 'Share codes',
  section: 'Share codes',
}
const CODE_ID = '99999999-9999-9999-9999-999999999999'
const ANOTHER_CODE_ID = '88888888-8888-8888-8888-888888888888'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
// Local times, so that the page's dates read the same in every time zone.
const ISSUED_AT = new Date(2026, 10, 11, 9, 15)
const EXPIRES_AT = new Date(2026, 10, 18, 9, 15)
// ADR 0024 lets a ServerAdmin set a Household's limit on live codes between 1 and 100.
const MOST_LIVE_CODES = 100
// The number of codes the server answers with when a read does not say how many it wants.
const SERVER_PAGE_SIZE = 100

function liveCode(overrides: Partial<ShareCodeNode> = {}): ShareCodeNode {
  return {
    __typename: 'ShareCode',
    id: CODE_ID,
    householdId: HOUSEHOLD_ID,
    status: 'LIVE',
    issuedAt: ISSUED_AT.toISOString(),
    expiresAt: new Date(Date.now() + 6 * DAY + HOUR).toISOString(),
    issuedByDisplayName: 'Sam',
    ...overrides,
  }
}

function codesData(codes: ShareCodeNode[] = []) {
  return {
    householdShareCodes: {
      __typename: 'ShareCodeConnection',
      edges: codes.map((node) => ({ __typename: 'ShareCodeEdge', node })),
    },
  }
}

function issued({
  shareCode = liveCode({ expiresAt: EXPIRES_AT.toISOString() }),
}: { shareCode?: ShareCodeNode } = {}) {
  return {
    issueShareCode: {
      __typename: 'IssueShareCodePayload',
      issued: { __typename: 'IssuedShareCode', code: SHARE_CODE, shareCode },
      userErrors: [],
    },
  }
}

function issueRefused(message: string) {
  return {
    issueShareCode: {
      __typename: 'IssueShareCodePayload',
      issued: null,
      userErrors: [{ __typename: 'ShareCodeLimitReachedError', message }],
    },
  }
}

function withdrawn(shareCodeId = CODE_ID) {
  return {
    withdrawShareCode: {
      __typename: 'WithdrawShareCodePayload',
      shareCode: { __typename: 'ShareCode', id: shareCodeId, status: 'WITHDRAWN' },
      userErrors: [],
    },
  }
}

function withdrawRefused(message: string) {
  return {
    withdrawShareCode: {
      __typename: 'WithdrawShareCodePayload',
      shareCode: null,
      userErrors: [{ __typename: 'ShareCodeNotLiveError', message }],
    },
  }
}

function serve(codes: ShareCodeNode[] = []) {
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: meFixture() } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    // Household settings open on Share offers, the way back to this page.
    graphql.query('ShareOffers', () =>
      HttpResponse.json({
        data: { householdShares: { __typename: 'ProfileShareConnection', edges: [] } },
      }),
    ),
    graphql.query('HouseholdShareCodes', ({ variables }) => {
      expect(variables).toEqual({ householdId: HOUSEHOLD_ID })
      return HttpResponse.json({ data: codesData(codes) })
    }),
  )
}

// Answers each read of the codes with the next list, and the last list from then on.
function serveInTurn(...lists: ShareCodeNode[][]) {
  serve()
  const handler = answersInTurn(...lists.map((codes) => answerWith(codesData(codes))))
  server.use(graphql.query('HouseholdShareCodes', handler.resolver))
  return handler
}

// Answers each read of the codes as the server does: the newest codes first, and only as many as
// the read's `first` asks for. An issue adds the issued code as the newest code. A withdrawal takes
// the withdrawn code out.
function serveHouseholdHolding(codes: ShareCodeNode[]) {
  let live = codes
  serve()
  server.use(
    graphql.query('HouseholdShareCodes', ({ query, variables }) => {
      let pageSize = SERVER_PAGE_SIZE
      visit(parse(query), {
        Argument({ name, value }) {
          if (name.value === 'first') pageSize = Number(valueFromASTUntyped(value, variables))
        },
      })
      return HttpResponse.json({ data: codesData(live.slice(0, pageSize)) })
    }),
    graphql.mutation('IssueShareCode', () => {
      live = [liveCode(), ...live]
      return HttpResponse.json({ data: issued() })
    }),
    graphql.mutation('WithdrawShareCode', ({ variables }) => {
      const shareCodeId = withdrawnCodeId(variables)
      live = live.filter((code) => code.id !== shareCodeId)
      return HttpResponse.json({ data: withdrawn(shareCodeId) })
    }),
  )
}

function serveIssue(answer: Parameters<typeof issued>[0] = {}) {
  server.use(
    graphql.mutation('IssueShareCode', ({ variables }) => {
      expect(variables).toEqual({ input: { householdId: HOUSEHOLD_ID } })
      return HttpResponse.json({ data: issued(answer) })
    }),
  )
}

function serveWithdraw() {
  server.use(
    graphql.mutation('WithdrawShareCode', ({ variables }) =>
      HttpResponse.json({ data: withdrawn(withdrawnCodeId(variables)) }),
    ),
  )
}

function withdrawnCodeId(variables: unknown): string {
  return (variables as { input: { shareCodeId: string } }).input.shareCodeId
}

// Issuing waits for the first read of the codes, so a test presses the button once the list loads.
async function pressIssue(user: ReturnType<typeof renderAppAt>['user']) {
  await screen.findByRole('region', { name: 'Live codes' })
  await user.click(screen.getByRole('button', { name: 'Issue a share code' }))
}

async function issue(user: ReturnType<typeof renderAppAt>['user']) {
  await pressIssue(user)
  return screen.findByText(SHARE_CODE)
}

// A change waits for the change before it, so a test presses Withdraw once the button allows it.
async function withdrawWhenAllowed(
  user: ReturnType<typeof renderAppAt>['user'],
  description: RegExp,
) {
  const live = screen.getByRole('region', { name: 'Live codes' })
  const withdraw = await within(live).findByRole('button', { name: 'Withdraw', description })
  await waitFor(() => expect(withdraw).toBeEnabled())
  await user.click(withdraw)
}

// Issues a code and holds the read after the issue, which keeps the issue button disabled until
// the test releases the read.
async function issueAndHoldTheReadAfterTheIssue() {
  const afterIssue = heldAnswer(codesData([liveCode()]))
  serve()
  const codes = answersInTurn(answerWith(codesData([])), afterIssue.answer)
  server.use(graphql.query('HouseholdShareCodes', codes.resolver))
  serveIssue()
  const { user } = renderAppAt(CODES)
  await issue(user)
  await waitFor(() => expect(codes.calls).toBe(2))
  return { user, release: afterIssue.release }
}

// The issue button stays disabled until the read after the change on its way lands.
async function waitForTheReadAfterTheIssue() {
  const issueAction = screen.getByRole('button', { name: 'Issue a share code' })
  await waitFor(() => expect(issueAction).toBeEnabled())
}

function failingClipboard() {
  return { writeText: () => Promise.reject(new Error('NotAllowedError')) }
}

describe('Share codes', () => {
  it('shouldOpenShareCodesAsASectionOfHouseholdSettingsUnderShareOffers', async () => {
    serve()
    renderAppAt(CODES)

    const menu = await screen.findByRole('navigation', { name: 'Household settings' })
    const sections = within(menu)
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(sections[sections.indexOf('Share invitations') + 1]).toBe('Share codes')
    expect(within(menu).getByRole('link', { name: 'Share codes' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    const page = screen.getByRole('region', { name: 'Share codes' })
    expect(
      await within(page).findByRole('heading', { level: 1, name: 'Share codes' }),
    ).toBeVisible()
    expect(
      within(page).getByText(
        'Give a code to someone in another Household so they can offer a Profile to Smith Family. A code works once, and an admin here still decides on every offer.',
      ),
    ).toBeVisible()
  })

  it('shouldSayThereAreNoLiveCodesWhenTheHouseholdHasNone', async () => {
    serve()
    renderAppAt(CODES)

    const live = await screen.findByRole('region', { name: 'Live codes' })
    expect(within(live).getByText('No live share codes.')).toBeVisible()
    expect(within(live).queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('shouldListEachLiveCodeWithWhoIssuedItWhenAndTheTimeItHasLeft', async () => {
    serve([
      liveCode(),
      liveCode({
        id: 'b',
        issuedByDisplayName: null,
        expiresAt: new Date(Date.now() + 3 * HOUR).toISOString(),
      }),
    ])
    renderAppAt(CODES)

    const live = await screen.findByRole('region', { name: 'Live codes' })
    const [first, second] = await within(live).findAllByRole('listitem')
    expect(within(first).getByText('Issued by Sam')).toBeVisible()
    expect(within(first).getByText('Nov 11, 2026')).toBeVisible()
    expect(within(first).getByText('Expires in 6 days')).toBeVisible()
    expect(within(first).getByRole('button', { name: 'Withdraw' })).toHaveAccessibleDescription(
      'Issued by Sam Nov 11, 2026 Expires in 6 days',
    )
    expect(within(second).getByText('Issued by a deleted Account')).toBeVisible()
    expect(within(second).getByText('Expires in 2 hours')).toBeVisible()
    expect(within(live).queryByText(SHARE_CODE)).not.toBeInTheDocument()
  })

  it('shouldLetAnAdminWithdrawTheOldestCodeWhenTheHouseholdHoldsTheMostLiveCodesItMay', async () => {
    const newer = Array.from({ length: MOST_LIVE_CODES - 1 }, (_, index) =>
      liveCode({ id: `newer-${index}` }),
    )
    serveHouseholdHolding([...newer, liveCode({ id: 'oldest', issuedByDisplayName: 'Rae' })])
    const { user } = renderAppAt(CODES)

    const live = await screen.findByRole('region', { name: 'Live codes' })
    expect(await within(live).findAllByRole('listitem')).toHaveLength(MOST_LIVE_CODES)
    await user.click(
      within(live).getByRole('button', { name: 'Withdraw', description: /^Issued by Rae / }),
    )

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Share code withdrawn.'),
    )
    expect(within(live).queryByText('Issued by Rae')).not.toBeInTheDocument()
    expect(within(live).getAllByRole('listitem')).toHaveLength(MOST_LIVE_CODES - 1)
  })

  it('shouldShowTheCodeOnceInThePageWhenAnAdminIssuesOne', async () => {
    const codes = serveInTurn([], [liveCode()])
    serveIssue()
    const { user } = renderAppAt(CODES)

    const code = await issue(user)

    expect(code).toHaveFocus()
    expect(code).toHaveAccessibleDescription(
      'This is the only time the code is shown. It works until Nov 18, 2026, 9:15 AM.',
    )
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(codes.calls).toBe(2))
    expect(await screen.findByText('Issued by Sam')).toBeVisible()
  })

  it('shouldCopyTheCodeAndSaySoWithoutMovingFocus', async () => {
    serveHouseholdHolding([])
    const { user } = renderAppAt(CODES)
    await issue(user)

    const copy = screen.getByRole('button', { name: 'Copy code' })
    await user.click(copy)

    expect(await screen.findByRole('status')).toHaveTextContent('Code copied.')
    expect(await navigator.clipboard.readText()).toBe(SHARE_CODE)
    expect(copy).toHaveFocus()
  })

  it('shouldCopyALinkThatOpensTheShareFormWithTheCode', async () => {
    serveHouseholdHolding([])
    const { user } = renderAppAt(CODES)
    await issue(user)

    await user.click(screen.getByRole('button', { name: 'Copy link' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Link copied.')
    expect(await navigator.clipboard.readText()).toBe(
      `https://streamarr.test/settings/profile/sharing?code=${SHARE_CODE}`,
    )
  })

  it.each([
    ['copy code', 'Copy code', "Couldn't copy the code. Select it and copy it yourself."],
    ['copy link', 'Copy link', "Couldn't copy the link. Select the code and give it instead."],
  ])('shouldSaySoAndSelectTheCodeWhenTheBrowserWillNotCopy(%s)', async (_, button, failure) => {
    serveHouseholdHolding([])
    const { user } = renderWithProviders(
      <ShareCodesScreen clipboard={failingClipboard()} origin="https://streamarr.test" />,
    )
    await issue(user)

    await user.click(screen.getByRole('button', { name: button }))

    expect(await screen.findByRole('alert')).toHaveTextContent(failure)
    expect(document.getSelection()?.toString()).toBe(SHARE_CODE)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('shouldSayTheCodeCannotBeCopiedWhenTheBrowserHasNoClipboard', async () => {
    serveHouseholdHolding([])
    const { user } = renderWithProviders(
      <ShareCodesScreen clipboard={null} origin="https://streamarr.test" />,
    )
    await issue(user)

    await user.click(screen.getByRole('button', { name: 'Copy code' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't copy the code. Select it and copy it yourself.",
    )
  })

  it('shouldTakeTheCodeAwayAndReturnToTheIssueButtonWhenTheAdminIsDone', async () => {
    serveHouseholdHolding([])
    const { user } = renderAppAt(CODES)
    await issue(user)

    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(screen.queryByText(SHARE_CODE)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Issue a share code' })).toHaveFocus()
  })

  it('shouldReturnToTheIssueButtonWhenTheAdminIsDoneBeforeTheReadAfterTheIssueArrives', async () => {
    const { user, release } = await issueAndHoldTheReadAfterTheIssue()
    const issueAction = screen.getByRole('button', { name: 'Issue a share code' })
    expect(issueAction).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Done' }))
    release()

    await waitFor(() => expect(issueAction).toHaveFocus())
  })

  it('shouldLeaveFocusWhereTheAdminMovedItWhenTheReadAfterTheIssueArrivesAfterDone', async () => {
    const { user, release } = await issueAndHoldTheReadAfterTheIssue()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    const shareOffers = screen.getByRole('link', { name: 'Share invitations' })
    act(() => shareOffers.focus())

    release()

    const issueAction = screen.getByRole('button', { name: 'Issue a share code' })
    await waitFor(() => expect(issueAction).toBeEnabled())
    expect(shareOffers).toHaveFocus()
  })

  it('shouldKeepTheCodeOutOfTheCacheTheAddressAndTheBrowsersStorage', async () => {
    serveHouseholdHolding([])
    const { user, router, apolloClient } = renderAppAt(CODES)

    await issue(user)

    const letters = SHARE_CODE.slice(0, 4)
    expect(JSON.stringify(apolloClient.cache.extract())).not.toContain(letters)
    expect(router.state.location.href).not.toContain(letters)
    expect(JSON.stringify({ ...localStorage })).not.toContain(letters)
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(letters)
  })

  it('shouldShowTheServersWordsWhenIssuingIsRefused', async () => {
    serve()
    server.use(
      graphql.mutation('IssueShareCode', () =>
        HttpResponse.json({ data: issueRefused('Smith Family already has 10 live share codes.') }),
      ),
    )
    const { user } = renderAppAt(CODES)

    await pressIssue(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Smith Family already has 10 live share codes\.$/,
    )
    expect(screen.queryByRole('button', { name: 'Copy code' })).not.toBeInTheDocument()
  })

  it('shouldShowTheServersWordsWhenTheServerRejectsTheIssue', async () => {
    serve()
    server.use(
      graphql.mutation('IssueShareCode', () =>
        HttpResponse.json({
          errors: [
            {
              message: 'Only an admin of Smith Family may issue share codes.',
              extensions: { code: 'FORBIDDEN' },
            },
          ],
        }),
      ),
    )
    const { user } = renderAppAt(CODES)

    await pressIssue(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Only an admin of Smith Family may issue share codes\.$/,
    )
  })

  it('shouldWithdrawACodeAtOnceAndSaySo', async () => {
    const codes = serveInTurn([liveCode()], [])
    server.use(
      graphql.mutation('WithdrawShareCode', ({ variables }) => {
        expect(variables).toEqual({ input: { shareCodeId: CODE_ID } })
        return HttpResponse.json({ data: withdrawn() })
      }),
    )
    const { user } = renderAppAt(CODES)

    await user.click(await screen.findByRole('button', { name: 'Withdraw' }))

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Share code withdrawn.'),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByText('No live share codes.')).toBeVisible()
    expect(codes.calls).toBe(2)
    expect(screen.getByRole('heading', { level: 1, name: 'Share codes' })).toHaveFocus()
  })

  it('shouldShowTheServersWordsAndReadTheCodesAgainWhenWithdrawingIsRefused', async () => {
    const codes = serveInTurn([liveCode()], [])
    server.use(
      graphql.mutation('WithdrawShareCode', () =>
        HttpResponse.json({ data: withdrawRefused('That share code no longer works.') }),
      ),
    )
    const { user } = renderAppAt(CODES)

    await user.click(await screen.findByRole('button', { name: 'Withdraw' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^That share code no longer works\.$/,
    )
    await waitFor(() => expect(codes.calls).toBe(2))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('shouldTakeTheIssuedCodeAwayWhenAnAdminWithdrawsThatCode', async () => {
    serveInTurn([], [liveCode()], [])
    serveIssue()
    serveWithdraw()
    const { user } = renderAppAt(CODES)
    await issue(user)

    await withdrawWhenAllowed(user, /^Issued by Sam /)

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Share code withdrawn.'),
    )
    expect(screen.queryByText(SHARE_CODE)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument()
  })

  it('shouldTakeTheIssuedCodeAwayWhenTheServerSaysThatCodeNoLongerWorks', async () => {
    // Another admin withdrew the code after this page listed it.
    serveInTurn([], [liveCode()], [])
    serveIssue()
    server.use(
      graphql.mutation('WithdrawShareCode', () =>
        HttpResponse.json({ data: withdrawRefused('That share code no longer works.') }),
      ),
    )
    const { user } = renderAppAt(CODES)
    await issue(user)

    await withdrawWhenAllowed(user, /^Issued by Sam /)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^That share code no longer works\.$/,
    )
    await waitFor(() => expect(screen.queryByText(SHARE_CODE)).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument()
  })

  it('shouldKeepTheIssuedCodeWhenAnAdminWithdrawsAnotherCode', async () => {
    const anasCode = liveCode({ id: ANOTHER_CODE_ID, issuedByDisplayName: 'Ana' })
    serveInTurn([anasCode], [liveCode(), anasCode], [liveCode()])
    serveIssue()
    serveWithdraw()
    const { user } = renderAppAt(CODES)
    await issue(user)

    await withdrawWhenAllowed(user, /^Issued by Ana /)

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Share code withdrawn.'),
    )
    expect(screen.getByText(SHARE_CODE)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeEnabled()
  })

  it('shouldTakeTheIssuedCodeAwayWhenALaterReadNoLongerListsThatCode', async () => {
    // Someone offers a Profile with the code while the page is open, and the offer spends the code.
    const codes = serveInTurn([], [liveCode()], [])
    serveIssue()
    const { user } = renderAppAt(CODES)
    await issue(user)
    await waitForTheReadAfterTheIssue()

    comeBackOnline()

    expect(await screen.findByText('No live share codes.')).toBeVisible()
    expect(codes.calls).toBe(3)
    expect(screen.queryByText(SHARE_CODE)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument()
  })

  it('shouldTakeTheIssuedCodeAwayWhenTheReadAfterTheIssueDoesNotListThatCode', async () => {
    // Someone offers a Profile with the code before the read after the issue, and the offer spends
    // the code. So no list ever holds the code.
    const afterIssue = heldAnswer(codesData([]))
    serve()
    const codes = answersInTurn(answerWith(codesData([])), afterIssue.answer)
    server.use(graphql.query('HouseholdShareCodes', codes.resolver))
    serveIssue()
    const { user } = renderAppAt(CODES)
    await issue(user)
    await waitFor(() => expect(codes.calls).toBe(2))

    afterIssue.release()

    await waitForTheReadAfterTheIssue()
    expect(screen.queryByText(SHARE_CODE)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument()
  })

  it('shouldReturnToTheIssueButtonWhenALaterReadTakesAwayTheIssuedCodeWhileFocusIsInItsPanel', async () => {
    serveInTurn([], [liveCode()], [])
    serveIssue()
    const { user } = renderAppAt(CODES)
    const code = await issue(user)
    await waitForTheReadAfterTheIssue()
    expect(code).toHaveFocus()

    comeBackOnline()

    await waitFor(() => expect(screen.queryByText(SHARE_CODE)).not.toBeInTheDocument())
    const issueAction = screen.getByRole('button', { name: 'Issue a share code' })
    await waitFor(() => expect(issueAction).toHaveFocus())
  })

  it('shouldLeaveFocusAloneWhenALaterReadTakesAwayTheIssuedCodeWhileFocusIsOutsideItsPanel', async () => {
    serveInTurn([], [liveCode()], [])
    serveIssue()
    const { user } = renderAppAt(CODES)
    const code = await issue(user)
    await waitForTheReadAfterTheIssue()
    // A click on the page outside the panel leaves focus on the page body.
    act(() => code.blur())

    comeBackOnline()

    await waitFor(() => expect(screen.queryByText(SHARE_CODE)).not.toBeInTheDocument())
    expect(document.body).toHaveFocus()
  })

  it('shouldKeepTheIssuedCodeWhenTheReadAfterTheIssueFails', async () => {
    serve()
    const codes = answersInTurn(answerWith(codesData([])), networkFailure)
    server.use(graphql.query('HouseholdShareCodes', codes.resolver))
    serveIssue()
    const { user } = renderAppAt(CODES)
    await issue(user)

    await waitForTheReadAfterTheIssue()

    expect(codes.calls).toBe(2)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load share codes.")
    expect(screen.getByText(SHARE_CODE)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeEnabled()
  })

  it('shouldTakeTheIssuedCodeAwayWhenARetryAfterAFailedReadNoLongerListsThatCode', async () => {
    // Someone offers a Profile with the code before the admin retries, and the offer spends the code.
    serve()
    const codes = answersInTurn(
      answerWith(codesData([])),
      networkFailure,
      answerWith(codesData([])),
    )
    server.use(graphql.query('HouseholdShareCodes', codes.resolver))
    serveIssue()
    const { user } = renderAppAt(CODES)
    await issue(user)
    await waitForTheReadAfterTheIssue()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('No live share codes.')).toBeVisible()
    expect(codes.calls).toBe(3)
    expect(screen.queryByText(SHARE_CODE)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument()
  })

  it('shouldKeepTheIssuedCodeWhenAReadFromBeforeTheIssueArrivesAfterAFailedRead', async () => {
    const issuedNow = liveCode({ id: ANOTHER_CODE_ID, issuedByDisplayName: 'Ana' })
    const fromBefore = heldAnswer(codesData([]))
    serve()
    const codes = answersInTurn(
      answerWith(codesData([liveCode()])),
      networkFailure,
      fromBefore.answer,
      answerWith(codesData([issuedNow])),
    )
    server.use(graphql.query('HouseholdShareCodes', codes.resolver))
    serveWithdraw()
    serveIssue({ shareCode: issuedNow })
    const { user } = renderAppAt(CODES)
    // The read after the withdrawal fails. Coming back online then reads the codes again, and that
    // read is still on its way when the admin issues a code.
    await user.click(await screen.findByRole('button', { name: 'Withdraw' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load share codes.")
    comeBackOnline()
    await waitFor(() => expect(codes.calls).toBe(3))

    await user.click(screen.getByRole('button', { name: 'Issue a share code' }))
    await screen.findByText(SHARE_CODE)
    fromBefore.release()

    expect(await screen.findByText('Issued by Ana')).toBeVisible()
    expect(codes.calls).toBe(4)
    expect(screen.getByText(SHARE_CODE)).toBeVisible()
  })

  it('shouldWaitToIssueACodeWhenAWithdrawalOrTheReadAfterItIsOnItsWay', async () => {
    const issuedLater = liveCode({ id: ANOTHER_CODE_ID, issuedByDisplayName: 'Ana' })
    const afterWithdrawal = heldAnswer(codesData([]))
    serve()
    const codes = answersInTurn(
      answerWith(codesData([liveCode()])),
      afterWithdrawal.answer,
      answerWith(codesData([issuedLater])),
    )
    server.use(graphql.query('HouseholdShareCodes', codes.resolver))
    serveWithdraw()
    serveIssue({ shareCode: issuedLater })
    const { user } = renderAppAt(CODES)

    await user.click(await screen.findByRole('button', { name: 'Withdraw' }))
    await waitFor(() => expect(codes.calls).toBe(2))

    const issueAction = screen.getByRole('button', { name: 'Issue a share code' })
    expect(issueAction).toBeDisabled()
    afterWithdrawal.release()
    await waitFor(() => expect(issueAction).toBeEnabled())
    await issue(user)
    expect(await screen.findByText('Issued by Ana')).toBeVisible()
  })

  it('shouldWaitToWithdrawACodeWhenAnIssueOrTheReadAfterItIsOnItsWay', async () => {
    const issuedNow = liveCode({ id: ANOTHER_CODE_ID, issuedByDisplayName: 'Ana' })
    const afterIssue = heldAnswer(codesData([liveCode(), issuedNow]))
    serve()
    const codes = answersInTurn(
      answerWith(codesData([liveCode()])),
      afterIssue.answer,
      answerWith(codesData([issuedNow])),
    )
    server.use(graphql.query('HouseholdShareCodes', codes.resolver))
    serveIssue({ shareCode: issuedNow })
    serveWithdraw()
    const { user } = renderAppAt(CODES)

    await issue(user)
    await waitFor(() => expect(codes.calls).toBe(2))

    const withdrawSamsCode = screen.getByRole('button', { name: 'Withdraw' })
    expect(withdrawSamsCode).toBeDisabled()
    afterIssue.release()
    await waitFor(() => expect(withdrawSamsCode).toBeEnabled())
    await user.click(withdrawSamsCode)
    await waitFor(() => expect(screen.queryByText('Issued by Sam')).not.toBeInTheDocument())
    expect(screen.getByText('Issued by Ana')).toBeVisible()
  })

  it('shouldWaitToIssueACodeWhenTheFirstReadOfTheCodesIsOnItsWay', async () => {
    const issuedNow = liveCode({ id: ANOTHER_CODE_ID, issuedByDisplayName: 'Ana' })
    const firstRead = heldAnswer(codesData([]))
    serve()
    const codes = answersInTurn(firstRead.answer, answerWith(codesData([issuedNow])))
    server.use(graphql.query('HouseholdShareCodes', codes.resolver))
    serveIssue({ shareCode: issuedNow })
    const { user } = renderAppAt(CODES)

    const issueAction = await screen.findByRole('button', { name: 'Issue a share code' })
    await waitFor(() => expect(codes.calls).toBe(1))
    expect(issueAction).toBeDisabled()
    firstRead.release()
    await waitFor(() => expect(issueAction).toBeEnabled())
    await issue(user)
    expect(await screen.findByText('Issued by Ana')).toBeVisible()
  })

  it('shouldListTheIssuedCodeWhenAReadFromBeforeTheIssueIsOnItsWay', async () => {
    const fromBefore = heldAnswer(codesData([]))
    serve()
    const codes = answersInTurn(
      answerWith(codesData([])),
      fromBefore.answer,
      answerWith(codesData([liveCode()])),
    )
    server.use(graphql.query('HouseholdShareCodes', codes.resolver))
    serveIssue()
    const { user } = renderAppAt(CODES)
    await screen.findByText('No live share codes.')
    comeBackOnline()
    await waitFor(() => expect(codes.calls).toBe(2))

    // The code shows once the server takes the issue. By then the read after the issue has started.
    await issue(user)
    fromBefore.release()

    expect(await screen.findByText('Issued by Sam')).toBeVisible()
  })

  it('shouldTakeTheWithdrawnCodeOffTheListWhenAReadFromBeforeTheWithdrawalIsOnItsWay', async () => {
    const fromBefore = heldAnswer(codesData([liveCode()]))
    serve()
    const codes = answersInTurn(
      answerWith(codesData([])),
      answerWith(codesData([liveCode()])),
      fromBefore.answer,
      answerWith(codesData([])),
    )
    server.use(graphql.query('HouseholdShareCodes', codes.resolver))
    serveIssue()
    serveWithdraw()
    const { user } = renderAppAt(CODES)
    await issue(user)
    await screen.findByText('Issued by Sam')
    comeBackOnline()
    await waitFor(() => expect(codes.calls).toBe(3))

    await withdrawWhenAllowed(user, /^Issued by Sam /)
    // The panel closes once the server takes the withdrawal. By then the read after the withdrawal
    // has started.
    await waitFor(() => expect(screen.queryByText(SHARE_CODE)).not.toBeInTheDocument())
    fromBefore.release()

    expect(await screen.findByText('No live share codes.')).toBeVisible()
  })

  it('shouldListACodeIssuedWhileTheAdminWasAwayWhenTheyReturn', async () => {
    serveInTurn([], [liveCode()])
    const { user } = renderAppAt(CODES)
    await screen.findByText('No live share codes.')

    await leaveForHomeAndReturn(user, SHARE_CODES)

    expect(await screen.findByText('Issued by Sam')).toBeVisible()
  })

  it('shouldShowTheLiveCodesAsLoadingUntilTheServerAnswersWhenTheAdminReturns', async () => {
    serve()
    const { user } = renderAppAt(CODES)
    await screen.findByText('No live share codes.')
    server.use(graphql.query('HouseholdShareCodes', () => delay('infinite')))

    await leaveForHomeAndReturn(user, SHARE_CODES)

    expect(await screen.findByRole('status', { name: 'Loading share codes' })).toBeInTheDocument()
    expect(screen.queryByText('No live share codes.')).not.toBeInTheDocument()
  })

  it('shouldRetryWhenTheLiveCodesFailToLoad', async () => {
    serve()
    const codes = failsOnceThen(codesData([liveCode()]))
    server.use(graphql.query('HouseholdShareCodes', codes.resolver))
    const { user } = renderAppAt(CODES)

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load share codes.")

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Issued by Sam')).toBeVisible()
    expect(codes.calls).toBe(2)
  })
})
