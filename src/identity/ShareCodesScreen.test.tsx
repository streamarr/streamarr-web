import { screen, waitFor, within } from '@testing-library/react'
import { delay, graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { HouseholdShareCodesQuery } from '../graphql/generated/graphql'
import { answersInTurn, answerWith, failsOnceThen } from '../test/graphqlResponses'
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
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
// Local times, so that the page's dates read the same in every time zone.
const ISSUED_AT = new Date(2026, 10, 11, 9, 15)
const EXPIRES_AT = new Date(2026, 10, 18, 9, 15)

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

function issued() {
  return {
    issueShareCode: {
      __typename: 'IssueShareCodePayload',
      issued: {
        __typename: 'IssuedShareCode',
        code: SHARE_CODE,
        shareCode: liveCode({ expiresAt: EXPIRES_AT.toISOString() }),
      },
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

function withdrawn() {
  return {
    withdrawShareCode: {
      __typename: 'WithdrawShareCodePayload',
      shareCode: { __typename: 'ShareCode', id: CODE_ID, status: 'WITHDRAWN' },
      userErrors: [],
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

function serveIssue() {
  server.use(
    graphql.mutation('IssueShareCode', ({ variables }) => {
      expect(variables).toEqual({ input: { householdId: HOUSEHOLD_ID } })
      return HttpResponse.json({ data: issued() })
    }),
  )
}

async function issue(user: ReturnType<typeof renderAppAt>['user']) {
  await user.click(await screen.findByRole('button', { name: 'Issue a share code' }))
  return screen.findByText(SHARE_CODE)
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
    expect(sections[sections.indexOf('Share offers') + 1]).toBe('Share codes')
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
    serve()
    serveIssue()
    const { user } = renderAppAt(CODES)
    await issue(user)

    const copy = screen.getByRole('button', { name: 'Copy code' })
    await user.click(copy)

    expect(await screen.findByRole('status')).toHaveTextContent('Code copied.')
    expect(await navigator.clipboard.readText()).toBe(SHARE_CODE)
    expect(copy).toHaveFocus()
  })

  it('shouldCopyALinkThatOpensTheShareFormWithTheCode', async () => {
    serve()
    serveIssue()
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
    serve()
    serveIssue()
    const { user } = renderWithProviders(
      <ShareCodesScreen clipboard={failingClipboard()} origin="https://streamarr.test" />,
    )
    await issue(user)

    await user.click(screen.getByRole('button', { name: button }))

    expect(await screen.findByRole('alert')).toHaveTextContent(failure)
    expect(document.getSelection()?.toString()).toBe(SHARE_CODE)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shouldSayTheCodeCannotBeCopiedWhenTheBrowserHasNoClipboard', async () => {
    serve()
    serveIssue()
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
    serve()
    serveIssue()
    const { user } = renderAppAt(CODES)
    await issue(user)

    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(screen.queryByText(SHARE_CODE)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Issue a share code' })).toHaveFocus()
  })

  it('shouldKeepTheCodeOutOfTheCacheTheAddressAndTheBrowsersStorage', async () => {
    serve()
    serveIssue()
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

    await user.click(await screen.findByRole('button', { name: 'Issue a share code' }))

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

    await user.click(await screen.findByRole('button', { name: 'Issue a share code' }))

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
        HttpResponse.json({
          data: {
            withdrawShareCode: {
              __typename: 'WithdrawShareCodePayload',
              shareCode: null,
              userErrors: [
                {
                  __typename: 'ShareCodeNotLiveError',
                  message: 'That share code no longer works.',
                },
              ],
            },
          },
        }),
      ),
    )
    const { user } = renderAppAt(CODES)

    await user.click(await screen.findByRole('button', { name: 'Withdraw' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^That share code no longer works\.$/,
    )
    await waitFor(() => expect(codes.calls).toBe(2))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
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
