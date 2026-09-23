import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { meFixture } from '../../test/meFixture'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'
import type {
  AddLibraryMutation,
  AddLibraryMutationVariables,
} from '../../graphql/generated/graphql'
import type { ManagedLibrary } from './libraryModel'

const ADMIN = meFixture({ scope: 'profile', serverAdmin: true })
const MOVIES: ManagedLibrary = {
  __typename: 'Library',
  id: 'movies',
  name: 'Movies',
  type: 'MOVIE',
  backend: 'LOCAL',
  filepathUri: '/media/movies',
  status: 'HEALTHY',
  scanStartedOn: null,
  scanCompletedOn: null,
}
const SHOWS: ManagedLibrary = {
  ...MOVIES,
  id: 'shows',
  name: 'TV shows',
  type: 'SERIES',
  filepathUri: '/media/tv',
}
const SETTINGS = '/settings/server/libraries'

function serve(libraries = [MOVIES, SHOWS], me = ADMIN) {
  const state = { libraries, me, inventoryRequests: 0 }
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: state.me } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: state.libraries } })),
    graphql.query('AdminLibraries', () => {
      state.inventoryRequests++
      return HttpResponse.json({ data: { libraries: state.libraries } })
    }),
    graphql.query('Home', () =>
      HttpResponse.json({
        data: {
          continueWatching: [],
          libraries: state.libraries.map((library) => ({ ...library, items: { edges: [] } })),
        },
      }),
    ),
  )
  return state
}

describe('library administration', () => {
  it.each([
    { ...ADMIN, serverAdmin: false },
    { ...ADMIN, deviceBound: true },
  ])('shouldRejectIneligibleDirectVisitsBeforeLoadingAdminInventory', async (me) => {
    const state = serve(undefined, me)
    const { user } = renderAppAt(SETTINGS)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Server settings are available to server admins',
    )
    expect(state.inventoryRequests).toBe(0)
    await user.click(screen.getByRole('button', { name: /Profile menu/ }))
    expect(screen.queryByRole('button', { name: 'Server settings' })).not.toBeInTheDocument()
  })

  it('shouldLetTheServerRequireAProfileInsteadOfDecidingScopeItself', async () => {
    const state = serve(undefined, meFixture({ scope: 'account', serverAdmin: true }))
    server.use(
      graphql.query('AdminLibraries', () => {
        state.inventoryRequests++
        return HttpResponse.json({
          errors: [{ message: 'profile required', extensions: { code: 'PROFILE_REQUIRED' } }],
        })
      }),
    )
    const { router } = renderAppAt(SETTINGS)
    await waitFor(() => expect(router.state.location.pathname).toBe('/select-profile'))
    expect(state.inventoryRequests).toBe(1)
  })

  it('shouldRestoreLibrarySelectionFromHistoryAfterProfileMenuEntry', async () => {
    serve()
    const { user, router } = renderAppAt('/')
    await user.click(await screen.findByRole('button', { name: /Profile menu/ }))
    await user.click(screen.getByRole('button', { name: 'Server settings' }))
    await screen.findByRole('article', { name: 'Movies settings' })
    await user.click(
      within(screen.getByRole('navigation', { name: 'Libraries to manage' })).getByRole('button', {
        name: /TV shows/,
      }),
    )
    await screen.findByRole('article', { name: 'TV shows settings' })
    expect(router.state.location.search).toEqual({ library: 'shows' })
    act(() => router.history.back())
    await screen.findByRole('article', { name: 'Movies settings' })
  })

  it('shouldDenyEntryWhenIdentityCannotBeConfirmed', async () => {
    serve()
    const { user } = renderAppAt('/')
    await user.click(await screen.findByRole('button', { name: /Profile menu/ }))
    server.use(
      graphql.query('Me', () => HttpResponse.json({ errors: [{ message: 'unavailable' }] })),
    )
    await user.click(screen.getByRole('button', { name: 'Server settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't confirm your access")
    expect(screen.queryByRole('button', { name: 'Scan library' })).not.toBeInTheDocument()
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({ data: { me: { ...ADMIN, serverAdmin: false } } }),
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Server settings are available to server admins',
      ),
    )
  })

  it('shouldDistinguishInventoryFailureFromAnEmptyServerAndRetry', async () => {
    serve([])
    server.use(
      graphql.query('AdminLibraries', () =>
        HttpResponse.json({ errors: [{ message: 'offline' }] }),
      ),
    )
    const { user } = renderAppAt(SETTINGS)
    await screen.findByRole('alert')
    expect(screen.queryByRole('link', { name: 'Add library' })).not.toBeInTheDocument()
    server.use(
      graphql.query('AdminLibraries', () => HttpResponse.json({ data: { libraries: [] } })),
    )
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('link', { name: 'Add library' })
  })

  it('shouldPreserveRejectedDraftAndSelectCreatedLibraryInsideSettings', async () => {
    const state = serve([])
    let submitted: unknown
    server.use(
      graphql.mutation<AddLibraryMutation, AddLibraryMutationVariables>(
        'AddLibrary',
        ({ variables }) => {
          submitted = variables.input
          if (variables.input.filepath === '/missing')
            return HttpResponse.json({
              data: {
                addLibrary: {
                  library: null,
                  userErrors: [
                    {
                      __typename: 'LibraryPathNotFoundError',
                      inputPath: ['filepath'],
                      message: 'This folder does not exist.',
                    },
                  ],
                },
              },
            })
          const library = {
            ...MOVIES,
            id: 'family',
            name: 'Family',
            filepathUri: '/media/family',
            status: 'SCANNING' as const,
          }
          state.libraries = [library]
          return HttpResponse.json({ data: { addLibrary: { library, userErrors: [] } } })
        },
      ),
    )
    const { user, router } = renderAppAt(`${SETTINGS}/new`)
    const name = await screen.findByRole('textbox', { name: /Library name/ })
    await user.clear(name)
    await user.type(name, 'Family')
    await user.type(screen.getByRole('textbox', { name: /Server folder/ }), '/missing')
    await user.click(screen.getByRole('button', { name: 'Add library' }))
    await screen.findByText('This folder does not exist.')
    expect(name).toHaveValue('Family')
    expect(screen.getByRole('textbox', { name: /Server folder/ })).toHaveFocus()
    await user.clear(screen.getByRole('textbox', { name: /Server folder/ }))
    await user.type(screen.getByRole('textbox', { name: /Server folder/ }), '/media/family')
    await user.click(screen.getByRole('button', { name: 'Add library' }))
    const detail = await screen.findByRole('article', { name: 'Family settings' })
    expect(detail).toHaveTextContent('SCANNING')
    expect(submitted).toEqual({
      name: 'Family',
      filepath: '/media/family',
      type: 'MOVIE',
      backend: 'LOCAL',
      externalAgentStrategy: 'TMDB',
    })
    expect(router.state.location.pathname).toBe(SETTINGS)
    expect(router.state.location.search).toEqual({ library: 'family' })
    expect(
      within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', {
        name: 'Family',
      }),
    ).toBeInTheDocument()
  })

  it('shouldStartTheNameEmptyAndLeaveItAloneWhenTheTypeChanges', async () => {
    serve([])
    const { user } = renderAppAt(`${SETTINGS}/new`)
    const name = await screen.findByRole('textbox', { name: /Library name/ })
    expect(name).toHaveValue('')
    expect(name).toHaveAttribute('placeholder', 'Movies')
    await user.click(screen.getByRole('radio', { name: 'TV shows' }))
    expect(name).toHaveValue('')
    await user.type(name, 'Family')
    await user.click(screen.getByRole('radio', { name: 'Movies' }))
    expect(name).toHaveValue('Family')
  })

  it('shouldDisplayUnknownCreationErrorsThroughTheirMessageFallback', async () => {
    serve([])
    server.use(
      graphql.mutation('AddLibrary', () =>
        HttpResponse.json({
          data: {
            addLibrary: {
              library: null,
              userErrors: [
                {
                  __typename: 'LibraryQuotaError',
                  message: 'This server cannot add another library.',
                },
              ],
            },
          },
        }),
      ),
    )
    const { user } = renderAppAt(`${SETTINGS}/new`)
    await user.type(await screen.findByRole('textbox', { name: /Library name/ }), 'Movies')
    await user.type(screen.getByRole('textbox', { name: /Server folder/ }), '/media/movies')
    await user.click(screen.getByRole('button', { name: 'Add library' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /cannot add another library|Something went wrong/,
    )
    expect(screen.getByRole('textbox', { name: /Server folder/ })).toHaveValue('/media/movies')
  })

  it('shouldPreventDuplicateCreationAndPreserveDraftAfterTransportFailure', async () => {
    serve([])
    let requests = 0
    server.use(
      graphql.mutation('AddLibrary', async () => {
        requests++
        await delay(100)
        return HttpResponse.error()
      }),
    )
    const { user } = renderAppAt(`${SETTINGS}/new`)
    await user.type(await screen.findByRole('textbox', { name: /Library name/ }), 'Family')
    await user.type(screen.getByRole('textbox', { name: /Server folder/ }), '/media/family')
    await user.dblClick(screen.getByRole('button', { name: 'Add library' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't confirm the operation")
    expect(screen.getByRole('textbox', { name: /Server folder/ })).toHaveValue('/media/family')
    expect(screen.getByRole('textbox', { name: /Library name/ })).toHaveValue('Family')
    expect(requests).toBe(1)
  })

  it('shouldRenderUnknownStatusesWithMaintenanceDisabled', async () => {
    serve([{ ...MOVIES, status: 'FUTURE_STATE' as ManagedLibrary['status'] }])
    renderAppAt(SETTINGS)
    const detail = await screen.findByRole('article', { name: 'Movies settings' })
    expect(detail).toHaveTextContent('Status unavailable')
    expect(within(detail).getByRole('button', { name: 'Scan library' })).toBeDisabled()
    expect(within(detail).getByRole('link', { name: 'View library' })).toHaveAttribute(
      'href',
      '/library/movies?by=ADDED&direction=DESC',
    )
  })

  it('shouldAcknowledgeScanWithoutInventingOrRefetchingStatus', async () => {
    const state = serve()
    server.use(
      graphql.mutation('ScanLibrary', () => {
        state.libraries = [{ ...MOVIES, status: 'SCANNING' }]
        return HttpResponse.json({ data: { scanLibrary: true } })
      }),
    )
    const { user, unmount } = renderAppAt(SETTINGS)
    const detail = await screen.findByRole('article', { name: 'Movies settings' })
    const requests = state.inventoryRequests
    await user.click(within(detail).getByRole('button', { name: 'Scan library' }))
    await screen.findByText('Scan requested for Movies. Refresh the page to see the latest status.')
    expect(detail).toHaveTextContent('HEALTHY')
    expect(state.inventoryRequests).toBe(requests)
    state.libraries = [{ ...MOVIES, status: 'UNHEALTHY', scanCompletedOn: '2026-09-22T13:00:00Z' }]
    unmount()
    renderAppAt(SETTINGS)
    expect(await screen.findByRole('article', { name: 'Movies settings' })).toHaveTextContent(
      'UNHEALTHY',
    )
    expect(screen.getByRole('article')).not.toHaveTextContent('Not scanned yet')
  })

  it('shouldSubmitSelectedImagePolicyAndRestoreRefreshTriggerFocus', async () => {
    const state = serve()
    let submitted: unknown
    server.use(
      graphql.mutation('RefreshLibrary', ({ variables }) => {
        submitted = variables
        return HttpResponse.json({ data: { refreshLibrary: true } })
      }),
    )
    const { user } = renderAppAt(SETTINGS)
    const trigger = await screen.findByRole('button', { name: 'Refresh metadata' })
    await user.click(trigger)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    const images = await screen.findByRole('combobox', { name: 'Images' })
    images.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')
    expect(images).toHaveValue('Download all images again')
    const requests = state.inventoryRequests
    await user.click(
      within(screen.getByRole('region', { name: 'Refresh metadata for Movies' })).getByRole(
        'button',
        { name: 'Refresh metadata' },
      ),
    )
    await screen.findByText(
      'Metadata refresh requested for Movies. Refresh the page to see the latest status.',
    )
    expect(submitted).toEqual({ id: 'movies', imageRefreshMode: 'FORCE_REFRESH' })
    expect(state.inventoryRequests).toBe(requests)
    expect(trigger).toHaveFocus()
  })

  it('shouldConfirmRemovalRetainFailuresAndUpdateNavigationAfterSuccess', async () => {
    const state = serve()
    let requests = 0
    server.use(
      graphql.mutation('RemoveLibrary', async () => {
        requests++
        await delay(80)
        if (requests === 1) return HttpResponse.json({ data: { removeLibrary: false } })
        state.libraries = [SHOWS]
        return HttpResponse.json({ data: { removeLibrary: true } })
      }),
    )
    const { user, router } = renderAppAt(SETTINGS)
    await user.click(await screen.findByRole('button', { name: 'Remove library' }))
    expect(requests).toBe(0)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(requests).toBe(0)
    await user.click(screen.getByRole('button', { name: 'Remove library' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove library' }),
    )
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    ).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't confirm the operation")
    expect(screen.getByRole('article', { name: 'Movies settings' })).toBeInTheDocument()
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove library' }),
    )
    await screen.findByRole('article', { name: 'TV shows settings' })
    await waitFor(() =>
      expect(
        within(screen.getByRole('navigation', { name: 'Primary' })).queryByRole('link', {
          name: 'Movies',
        }),
      ).not.toBeInTheDocument(),
    )
    expect(router.state.location.search).toEqual({ library: 'shows' })
    expect(requests).toBe(2)
  })

  it('shouldMoveFocusToTheHeadingOnlyWhenANoticeAppears', async () => {
    const state = serve()
    server.use(
      graphql.mutation('RemoveLibrary', () => {
        state.libraries = [SHOWS]
        return HttpResponse.json({ data: { removeLibrary: true } })
      }),
    )
    const { user } = renderAppAt(SETTINGS)
    await screen.findByRole('article', { name: 'Movies settings' })
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Remove library' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove library' }),
    )
    await screen.findByText('Movies removed. Files were kept on disk.')
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
    const row = within(screen.getByRole('navigation', { name: 'Libraries to manage' })).getByRole(
      'button',
      { name: /TV shows/ },
    )
    await user.click(row)
    expect(screen.queryByText('Movies removed. Files were kept on disk.')).not.toBeInTheDocument()
    expect(row).toHaveFocus()
  })

  it('shouldRemoveTheLastLibraryAtOnceAndOfferCreation', async () => {
    const state = serve([MOVIES])
    server.use(
      graphql.mutation('RemoveLibrary', () => {
        state.libraries = []
        return HttpResponse.json({ data: { removeLibrary: true } })
      }),
    )
    const { user, router } = renderAppAt(SETTINGS)
    await user.click(await screen.findByRole('button', { name: 'Remove library' }))
    // Neither refetch answers: what the admin sees comes from the removal itself.
    server.use(
      graphql.query('AdminLibraries', () => delay('infinite')),
      graphql.query('Libraries', () => delay('infinite')),
    )
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove library' }),
    )
    const heading = await screen.findByRole('heading', { name: 'Add your first library' })
    expect(heading).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('navigation', { name: 'Libraries to manage' }),
    ).not.toBeInTheDocument()
    await act(() => router.navigate({ to: '/' }))
    await screen.findByRole('link', { name: 'Add library' })
  })

  it('shouldDisableMaintenanceAfterFailedInventoryLoadAndRecoverOnRetry', async () => {
    serve()
    const { user, router } = renderAppAt(SETTINGS)
    await screen.findByRole('article', { name: 'Movies settings' })
    await act(() => router.navigate({ to: '/' }))
    server.use(
      graphql.query('AdminLibraries', () =>
        HttpResponse.json({ errors: [{ message: 'offline' }] }),
      ),
    )
    await act(() => router.navigate({ to: SETTINGS }))
    await screen.findByRole('alert')
    // Apollo may discard failed-query data; neither a stale action nor a setup CTA is permitted.
    expect(screen.queryByRole('button', { name: 'Scan library' })).not.toBeEnabled()
    server.use(
      graphql.query('AdminLibraries', () => HttpResponse.json({ data: { libraries: [MOVIES] } })),
    )
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Scan library' })).toBeEnabled())
  })

  it('shouldDrawDisclosureAndGuidanceGlyphsAtSixteenPixels', async () => {
    serve()
    const { router } = renderAppAt(SETTINGS)
    const row = within(
      await screen.findByRole('navigation', { name: 'Libraries to manage' }),
    ).getByRole('button', { name: /TV shows/ })
    expect(row.lastElementChild).toHaveAttribute('width', '16')
    await act(() => router.navigate({ to: `${SETTINGS}/new` }))
    const guidance = await screen.findByText('The initial scan starts automatically.')
    expect(guidance.querySelector('svg')).toHaveAttribute('width', '16')
  })

  it('shouldShowUnavailableLibraryForRemovedDeepLinks', async () => {
    serve()
    renderAppAt(`${SETTINGS}?library=gone`)
    await screen.findByRole('heading', { name: 'Library unavailable' })
    expect(screen.queryByRole('button', { name: 'Remove library' })).not.toBeInTheDocument()
  })
})
