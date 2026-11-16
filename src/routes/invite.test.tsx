import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { InvitationPreview } from '../auth/api'
import { invitationPreviewFixture } from '../test/invitationFixtures'
import { renderAppAt } from '../test/render'
import { server } from '../test/server'

const CODE = 'pub-1234.super-secret'
const SECOND_CODE = 'pub-5678.other-secret'

/**
 * Answers the lookup of each code in `invitations` with its preview, and every other code as one
 * that does not work. Records the codes asked about, in order.
 */
function serveLookUps(invitations: Record<string, InvitationPreview> = {}) {
  const asked = { codes: [] as string[] }
  server.use(
    http.post<never, { code: string }>('/api/auth/invitation/lookup', async ({ request }) => {
      const { code } = await request.json()
      asked.codes.push(code)
      const preview = invitations[code]
      if (preview) return HttpResponse.json(preview)
      return HttpResponse.json(
        { code: 'INVALID_CODE', message: 'That code is not redeemable.' },
        { status: 404 },
      )
    }),
  )
  return asked
}

function linkTo(code: string) {
  return `/invite#code=${encodeURIComponent(code)}`
}

describe('/invite', () => {
  it('shouldTakeTheCodeFromTheFragmentAndOutOfTheAddressWhileKeepingItAsThePrefillWhenALinkArrives', async () => {
    const asked = serveLookUps()
    const { router } = renderAppAt(linkTo(CODE))

    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not redeemable.')
    expect(screen.getByLabelText(/^invitation code/i)).toHaveValue(CODE)
    expect(asked.codes).toEqual([CODE])

    await waitFor(() => expect(router.state.location.hash).toBe(''))
    expect(router.state.location.pathname).toBe('/invite')
    expect(router.state.location.searchStr).toBe('')
    // Taken out through the router, so the entry keeps the index later navigations build on.
    expect(typeof router.state.location.state.__TSR_index).toBe('number')
    expect(router.history.length).toBe(1)
  })

  it('shouldReviewTheSecondInvitationWhenASecondLinkOpensWhileTheInvitationPageIsOpen', async () => {
    const asked = serveLookUps({
      [SECOND_CODE]: invitationPreviewFixture({ householdName: 'Lake House' }),
    })
    const { router } = renderAppAt(linkTo(CODE))
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not redeemable.')
    await waitFor(() => expect(router.state.location.hash).toBe(''))

    // Pasted into the address bar of the open page, the link changes only the fragment, so the
    // browser keeps the page and adds a history entry.
    act(() => router.history.push(linkTo(SECOND_CODE)))

    expect(await screen.findByText('You were invited to Lake House.')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(asked.codes).toEqual([CODE, SECOND_CODE])
    await waitFor(() => expect(router.state.location.hash).toBe(''))
  })

  it('shouldLookNothingUpWhenThePersonReloadsThePageTheLinkOpened', async () => {
    const asked = serveLookUps()
    const { router, unmount } = renderAppAt(linkTo(CODE))
    await screen.findByRole('alert')
    await waitFor(() => expect(router.state.location.hash).toBe(''))
    const reloaded = router.state.location.href
    unmount()

    renderAppAt(reloaded)

    expect(await screen.findByLabelText(/^invitation code/i)).toHaveValue('')
    expect(asked.codes).toEqual([CODE])
  })
})
