import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, graphql, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '../../test/deferred'
import { serveGraphqlSocket } from '../../test/graphqlSocket'
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
  const state = { libraries, me, inventoryRequests: 0, socket: serveGraphqlSocket() }
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

type User = ReturnType<typeof renderAppAt>['user']

async function scanMovies(user: User) {
  const detail = await screen.findByRole('article', { name: 'Movies settings' })
  await user.click(within(detail).getByRole('button', { name: 'Scan library' }))
}

async function refreshMovies(user: User) {
  const detail = await screen.findByRole('article', { name: 'Movies settings' })
  await user.click(within(detail).getByRole('button', { name: 'Refresh metadata' }))
  const editor = await screen.findByRole('region', { name: 'Refresh metadata for Movies' })
  await user.click(within(editor).getByRole('button', { name: 'Refresh metadata' }))
}

function removed(removedLibraryId: string) {
  return { data: { removeLibrary: { removedLibraryId, userErrors: [] } } }
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
    // The read once live status subscribes may land before the page leaves.
    expect(state.inventoryRequests).toBeGreaterThan(0)
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
    await user.click(screen.getByRole('button', { name: 'Retry' }))
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
    await user.click(screen.getByRole('button', { name: 'Retry' }))
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
    expect(screen.queryByText('This folder does not exist.')).not.toBeInTheDocument()
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

  it('shouldSayNothingStartedAndKeepTheDraftWhenCreationFailsWithTheNotStartedCode', async () => {
    serve([])
    server.use(
      graphql.mutation('AddLibrary', () =>
        HttpResponse.json({
          data: { addLibrary: null },
          errors: [
            {
              message: 'Service unavailable',
              path: ['addLibrary'],
              extensions: { classification: 'UNAVAILABLE', code: 'LIBRARY_OPERATION_NOT_STARTED' },
            },
          ],
        }),
      ),
    )
    const { user } = renderAppAt(`${SETTINGS}/new`)
    await user.type(await screen.findByRole('textbox', { name: /Library name/ }), 'Family')
    await user.type(screen.getByRole('textbox', { name: /Server folder/ }), '/media/family')

    await user.click(screen.getByRole('button', { name: 'Add library' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nothing started. The library was not added. Try again.',
    )
    expect(screen.getByRole('textbox', { name: /Server folder/ })).toHaveValue('/media/family')
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

  it('shouldShowTheScanningLibraryFromTheScanPayloadWithoutReadingTheInventoryAgain', async () => {
    const state = serve()
    let submitted: unknown
    server.use(
      graphql.mutation('StartLibraryScan', ({ variables }) => {
        submitted = variables
        const library = { ...MOVIES, status: 'SCANNING' as const }
        return HttpResponse.json({ data: { startLibraryScan: { library, userErrors: [] } } })
      }),
    )
    const { user } = renderAppAt(SETTINGS)
    const detail = await screen.findByRole('article', { name: 'Movies settings' })
    const requests = state.inventoryRequests

    await user.click(within(detail).getByRole('button', { name: 'Scan library' }))

    await within(detail).findByText('Scan requested for Movies.')
    expect(detail).toHaveTextContent('SCANNING')
    const row = within(screen.getByRole('navigation', { name: 'Libraries to manage' })).getByRole(
      'button',
      { name: /Movies/ },
    )
    expect(row).toHaveTextContent('SCANNING')
    expect(within(detail).getByRole('button', { name: 'Scan library' })).toBeDisabled()
    expect(submitted).toEqual({ input: { libraryId: 'movies' } })
    expect(state.inventoryRequests).toBe(requests)

    await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
    state.socket.publish('LibraryStatusChanged', {
      data: { libraryStatusChanged: { ...MOVIES, scanCompletedOn: '2026-10-15T12:05:00Z' } },
    })
    await waitFor(() => expect(detail).toHaveTextContent('HEALTHY'))
    expect(detail).not.toHaveTextContent('Scan requested for Movies.')
  })

  it.each([
    { __typename: 'LibraryNotFoundError', message: 'This library no longer exists.' },
    { __typename: 'InvalidIdError', message: 'This library id is not valid.' },
  ])('shouldShowTheServerMessageWhenAScanIsRefusedWith$__typename', async (refusal) => {
    serve()
    server.use(
      graphql.mutation('StartLibraryScan', () =>
        HttpResponse.json({
          data: {
            startLibraryScan: {
              library: null,
              userErrors: [{ ...refusal, inputPath: ['input', 'libraryId'] }],
            },
          },
        }),
      ),
    )
    const { user } = renderAppAt(SETTINGS)
    const detail = await screen.findByRole('article', { name: 'Movies settings' })

    await user.click(within(detail).getByRole('button', { name: 'Scan library' }))

    expect(await within(detail).findByRole('alert')).toHaveTextContent(refusal.message)
    expect(detail).not.toHaveTextContent('Scan requested')
    expect(within(detail).getByRole('button', { name: 'Scan library' })).toBeEnabled()
  })

  it('shouldShowTheGenericMessageWhenARefusalIsAMemberTheClientDoesNotKnow', async () => {
    serve()
    server.use(
      graphql.mutation('StartLibraryRefresh', () =>
        HttpResponse.json({
          data: {
            startLibraryRefresh: {
              library: null,
              userErrors: [{ __typename: 'LibraryQuotaError' }],
            },
          },
        }),
      ),
    )
    const { user } = renderAppAt(SETTINGS)
    await user.click(await screen.findByRole('button', { name: 'Refresh metadata' }))
    await user.click(
      within(await screen.findByRole('region', { name: 'Refresh metadata for Movies' })).getByRole(
        'button',
        { name: 'Refresh metadata' },
      ),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
    expect(screen.getByRole('region', { name: 'Refresh metadata for Movies' })).toBeInTheDocument()
  })

  it('shouldShowTheBusyRefusalWhenASecondIdenticalScanArrivesWhileOneRuns', async () => {
    serve()
    server.use(
      graphql.mutation('StartLibraryScan', () =>
        HttpResponse.json({
          data: {
            startLibraryScan: {
              library: null,
              userErrors: [
                {
                  __typename: 'LibraryBusyError',
                  message: 'A library scan is already in progress.',
                  status: 'SCANNING',
                },
              ],
            },
          },
        }),
      ),
    )
    const { user } = renderAppAt(SETTINGS)
    const detail = await screen.findByRole('article', { name: 'Movies settings' })

    await user.click(within(detail).getByRole('button', { name: 'Scan library' }))

    expect(await within(detail).findByRole('alert')).toHaveTextContent(
      'A library scan is already in progress.',
    )
    expect(detail).not.toHaveTextContent('Scan requested')
    await waitFor(() => expect(detail).toHaveTextContent('SCANNING'))
    expect(
      within(screen.getByRole('navigation', { name: 'Libraries to manage' })).getByRole('button', {
        name: /Movies/,
      }),
    ).toHaveTextContent('SCANNING')
    expect(within(detail).getByRole('button', { name: 'Scan library' })).toBeDisabled()
  })

  it('shouldShowTheStatusABusyRefusalCarriesWhenARefreshMeetsARunningScan', async () => {
    serve()
    server.use(
      graphql.mutation('StartLibraryRefresh', () =>
        HttpResponse.json({
          data: {
            startLibraryRefresh: {
              library: null,
              userErrors: [
                {
                  __typename: 'LibraryBusyError',
                  message: 'A library scan is already in progress.',
                  status: 'SCANNING',
                },
              ],
            },
          },
        }),
      ),
    )
    const { user } = renderAppAt(SETTINGS)
    const detail = await screen.findByRole('article', { name: 'Movies settings' })
    await user.click(within(detail).getByRole('button', { name: 'Refresh metadata' }))

    await user.click(
      within(await screen.findByRole('region', { name: 'Refresh metadata for Movies' })).getByRole(
        'button',
        { name: 'Refresh metadata' },
      ),
    )

    expect(await within(detail).findByRole('alert')).toHaveTextContent(
      'A library scan is already in progress.',
    )
    await waitFor(() => expect(detail).toHaveTextContent('SCANNING'))
  })

  it('shouldShowTheBusyRefusalInTheRemovalDialog', async () => {
    const state = serve()
    server.use(
      graphql.mutation('RemoveLibrary', () =>
        HttpResponse.json({
          data: {
            removeLibrary: {
              removedLibraryId: null,
              userErrors: [
                {
                  __typename: 'LibraryBusyError',
                  message: 'A library refresh is already in progress.',
                  status: 'REFRESHING',
                },
              ],
            },
          },
        }),
      ),
    )
    const { user } = renderAppAt(SETTINGS)
    await user.click(await screen.findByRole('button', { name: 'Remove library' }))

    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove library' }),
    )

    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'A library refresh is already in progress.',
    )
    const detail = screen.getByRole('article', { name: 'Movies settings' })
    await waitFor(() => expect(detail).toHaveTextContent('REFRESHING'))
    expect(state.libraries).toContain(MOVIES)
  })

  it.each([
    { operationName: 'StartLibraryScan', field: 'startLibraryScan', start: scanMovies },
    { operationName: 'StartLibraryRefresh', field: 'startLibraryRefresh', start: refreshMovies },
  ])(
    'shouldSayNothingStartedWhenTheNotStartedCodeAnswers$operationName',
    async ({ operationName, field, start }) => {
      serve()
      server.use(
        graphql.mutation(operationName, () =>
          HttpResponse.json({
            data: { [field]: null },
            errors: [
              {
                message: 'Service unavailable',
                path: [field],
                extensions: {
                  classification: 'UNAVAILABLE',
                  code: 'LIBRARY_OPERATION_NOT_STARTED',
                },
              },
            ],
          }),
        ),
      )
      const { user } = renderAppAt(SETTINGS)

      await start(user)

      const detail = screen.getByRole('article', { name: 'Movies settings' })
      expect(await within(detail).findByRole('alert')).toHaveTextContent(
        'Nothing started. The library is unchanged. Try again.',
      )
      expect(detail).toHaveTextContent('HEALTHY')
      expect(within(detail).getByRole('button', { name: 'Scan library' })).toBeEnabled()
    },
  )

  it('shouldShowEachStatusChangeLiveWithoutReadingTheInventoryAgain', async () => {
    const state = serve()
    renderAppAt(SETTINGS)
    const detail = await screen.findByRole('article', { name: 'Movies settings' })
    await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
    const requests = state.inventoryRequests

    state.socket.publish('LibraryStatusChanged', {
      data: {
        libraryStatusChanged: {
          ...MOVIES,
          status: 'SCANNING',
          scanStartedOn: '2026-10-15T12:00:00Z',
        },
      },
    })
    await waitFor(() => expect(detail).toHaveTextContent('SCANNING'))
    expect(within(detail).getByRole('button', { name: 'Scan library' })).toBeDisabled()
    expect(detail).toHaveTextContent('Maintenance is in progress. You can still view this library.')
    expect(detail).toHaveTextContent('Not completed yet')

    state.socket.publish('LibraryStatusChanged', {
      data: {
        libraryStatusChanged: {
          ...MOVIES,
          status: 'HEALTHY',
          scanStartedOn: '2026-10-15T12:00:00Z',
          scanCompletedOn: '2026-10-15T12:05:00Z',
        },
      },
    })
    await waitFor(() => expect(detail).toHaveTextContent('HEALTHY'))
    expect(within(detail).getByRole('button', { name: 'Scan library' })).toBeEnabled()
    expect(detail).not.toHaveTextContent('Not completed yet')
    expect(state.inventoryRequests).toBe(requests)
  })

  it('shouldWatchStatusAdditionsAndRemovalsOverOneSocket', async () => {
    const state = serve()

    renderAppAt(SETTINGS)

    await screen.findByRole('article', { name: 'Movies settings' })
    await waitFor(() =>
      expect([...state.socket.state.subscribes].sort()).toEqual([
        'LibraryAdded',
        'LibraryRemoved',
        'LibraryStatusChanged',
      ]),
    )
    expect(state.socket.state.connections).toBe(1)
  })

  it('shouldListALibraryAnotherSessionAddedOnlyOnce', async () => {
    const state = serve()
    renderAppAt(SETTINGS)
    await screen.findByRole('article', { name: 'Movies settings' })
    await waitFor(() => expect(state.socket.isLive('LibraryAdded')).toBe(true))
    const family = { ...MOVIES, id: 'family', name: 'Family', status: 'SCANNING' as const }

    state.socket.publish('LibraryAdded', { data: { libraryAdded: family } })
    state.socket.publish('LibraryAdded', { data: { libraryAdded: family } })

    const inventory = screen.getByRole('navigation', { name: 'Libraries to manage' })
    await within(inventory).findByRole('button', { name: /Family/ })
    expect(within(inventory).getAllByRole('button')).toHaveLength(3)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Libraries3')
  })

  it('shouldListALibraryWhoseStatusChangeArrivesBeforeItsAddition', async () => {
    const state = serve()
    renderAppAt(SETTINGS)
    await screen.findByRole('article', { name: 'Movies settings' })
    await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))

    state.socket.publish('LibraryStatusChanged', {
      data: { libraryStatusChanged: { ...MOVIES, id: 'family', name: 'Family' } },
    })

    await within(screen.getByRole('navigation', { name: 'Libraries to manage' })).findByRole(
      'button',
      { name: /Family/ },
    )
  })

  it('shouldDropALibraryAnotherSessionRemoved', async () => {
    const state = serve()
    renderAppAt(SETTINGS)
    await screen.findByRole('article', { name: 'Movies settings' })
    await waitFor(() => expect(state.socket.isLive('LibraryRemoved')).toBe(true))

    state.socket.publish('LibraryRemoved', {
      data: { libraryRemoved: { __typename: 'LibraryRemoval', libraryId: 'shows' } },
    })

    const inventory = screen.getByRole('navigation', { name: 'Libraries to manage' })
    await waitFor(() =>
      expect(within(inventory).queryByRole('button', { name: /TV shows/ })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('article', { name: 'Movies settings' })).toBeInTheDocument()
  })

  it('shouldKeepARemovedLibraryOutWhenItsEarlierChangesArriveLate', async () => {
    const state = serve()
    renderAppAt(SETTINGS)
    const detail = await screen.findByRole('article', { name: 'Movies settings' })
    await waitFor(() => expect(state.socket.isLive('LibraryRemoved')).toBe(true))
    const inventory = screen.getByRole('navigation', { name: 'Libraries to manage' })

    state.socket.publish('LibraryRemoved', {
      data: { libraryRemoved: { __typename: 'LibraryRemoval', libraryId: 'shows' } },
    })
    await waitFor(() =>
      expect(within(inventory).queryByRole('button', { name: /TV shows/ })).not.toBeInTheDocument(),
    )
    // Fields share no order, so a change committed before the removal can arrive after it.
    state.socket.publish('LibraryStatusChanged', {
      data: { libraryStatusChanged: { ...SHOWS, status: 'HEALTHY' } },
    })
    state.socket.publish('LibraryAdded', { data: { libraryAdded: SHOWS } })
    state.socket.publish('LibraryStatusChanged', {
      data: { libraryStatusChanged: { ...MOVIES, status: 'SCANNING' } },
    })

    await waitFor(() => expect(detail).toHaveTextContent('SCANNING'))
    expect(within(inventory).queryByRole('button', { name: /TV shows/ })).not.toBeInTheDocument()
  })

  it('shouldKeepARemovedLibraryOutWhenAnEarlierReadArrivesLate', async () => {
    const state = serve()
    renderAppAt(SETTINGS)
    const detail = await screen.findByRole('article', { name: 'Movies settings' })
    await waitFor(() => expect(state.socket.isLive('LibraryRemoved')).toBe(true))
    const inventory = screen.getByRole('navigation', { name: 'Libraries to manage' })
    const removalApplied = deferred()
    const requests = state.inventoryRequests
    server.use(
      graphql.query('AdminLibraries', async () => {
        // This read takes its snapshot before another session removes TV shows.
        const libraries = [{ ...MOVIES, status: 'REFRESHING' as const }, SHOWS]
        state.inventoryRequests++
        await removalApplied.promise
        return HttpResponse.json({ data: { libraries } })
      }),
    )

    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(state.inventoryRequests).toBe(requests + 1))
    state.socket.publish('LibraryRemoved', {
      data: { libraryRemoved: { __typename: 'LibraryRemoval', libraryId: 'shows' } },
    })
    await waitFor(() =>
      expect(within(inventory).queryByRole('button', { name: /TV shows/ })).not.toBeInTheDocument(),
    )
    removalApplied.resolve()

    await waitFor(() => expect(detail).toHaveTextContent('REFRESHING'))
    await waitFor(() =>
      expect(within(inventory).queryByRole('button', { name: /TV shows/ })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Libraries1')
  })

  it('shouldSayWhenTheServerNoLongerAllowsLiveStatus', async () => {
    const state = serve()
    renderAppAt(SETTINGS)
    await screen.findByRole('article', { name: 'Movies settings' })
    await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))

    state.socket.publish('LibraryStatusChanged', {
      errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }],
    })
    state.socket.complete('LibraryStatusChanged')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You no longer have permission to manage libraries.',
    )
    expect(state.socket.state.subscribes.filter((name) => name === 'LibraryStatusChanged')).toEqual(
      ['LibraryStatusChanged'],
    )
  })

  it('shouldSayWhenLiveStatusStopsForAnotherReason', async () => {
    const state = serve()
    renderAppAt(SETTINGS)
    await screen.findByRole('article', { name: 'Movies settings' })
    await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))

    state.socket.closeAll(4400, 'Invalid message')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Live status stopped. Reload the page to see the latest status.',
    )
  })

  it('shouldReadTheInventoryAgainOnceLiveStatusIsSubscribed', async () => {
    const state = serve()
    server.use(
      graphql.query('AdminLibraries', async () => {
        const libraries = state.libraries
        if (state.inventoryRequests++ === 0) {
          // A scan starts after this read and before the socket subscribes, so no change reports it.
          state.libraries = [{ ...MOVIES, status: 'SCANNING' }, SHOWS]
          await vi.waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
          // The read is still in flight when the socket reports its subscription.
          await delay(200)
        }
        return HttpResponse.json({ data: { libraries } })
      }),
    )

    renderAppAt(SETTINGS)

    const detail = await screen.findByRole('article', { name: 'Movies settings' })
    await waitFor(() => expect(detail).toHaveTextContent('SCANNING'))
    expect(state.inventoryRequests).toBe(2)
  })

  it('shouldReadTheInventoryAgainOnceLiveStatusIsSubscribedWhenAnotherQueryFailsItsRead', async () => {
    const state = serve()
    let navigationReads = 0
    server.use(
      graphql.query('Libraries', () =>
        navigationReads++ === 0
          ? HttpResponse.json({ data: { libraries: state.libraries } })
          : HttpResponse.json({ errors: [{ message: 'unavailable' }] }),
      ),
      graphql.query('AdminLibraries', async () => {
        const libraries = state.libraries
        if (state.inventoryRequests++ === 0) {
          // A scan starts after this read and before the socket subscribes, so no change reports it.
          state.libraries = [{ ...MOVIES, status: 'SCANNING' }, SHOWS]
          await vi.waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
          // The navigation's refetch fails while this read is still in flight.
          await vi.waitFor(() => expect(navigationReads).toBeGreaterThan(1))
          await delay(200)
        }
        return HttpResponse.json({ data: { libraries } })
      }),
    )

    renderAppAt(SETTINGS)

    const detail = await screen.findByRole('article', { name: 'Movies settings' })
    await waitFor(() => expect(detail).toHaveTextContent('SCANNING'))
    expect(state.inventoryRequests).toBe(2)
  })

  it('shouldReadTheInventoryAgainAfterTheSocketReconnects', async () => {
    const state = serve()
    renderAppAt(SETTINGS)
    const detail = await screen.findByRole('article', { name: 'Movies settings' })
    await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
    const requests = state.inventoryRequests
    state.libraries = [{ ...MOVIES, status: 'REFRESHING' }, SHOWS]

    state.socket.closeAll(1001, 'Going away')

    await waitFor(() => expect(detail).toHaveTextContent('REFRESHING'), { timeout: 3_000 })
    await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
    expect(state.socket.state.connections).toBe(2)
    expect(state.inventoryRequests).toBe(requests + 1)
  })

  it('shouldSubmitSelectedImagePolicyAndShowTheRefreshingLibraryFromThePayload', async () => {
    const state = serve()
    let submitted: unknown
    server.use(
      graphql.mutation('StartLibraryRefresh', ({ variables }) => {
        submitted = variables
        const library = { ...MOVIES, status: 'REFRESHING' as const }
        return HttpResponse.json({ data: { startLibraryRefresh: { library, userErrors: [] } } })
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
    const detail = screen.getByRole('article', { name: 'Movies settings' })
    await waitFor(() => expect(detail).toHaveTextContent('REFRESHING'))
    expect(await screen.findByText('Metadata refresh requested for Movies.')).toHaveFocus()
    expect(submitted).toEqual({ input: { libraryId: 'movies', imageRefreshMode: 'FORCE_REFRESH' } })
    expect(state.inventoryRequests).toBe(requests)
  })

  it('shouldConfirmRemovalRetainFailuresAndUpdateNavigationAfterSuccess', async () => {
    const state = serve()
    let requests = 0
    server.use(
      graphql.mutation('RemoveLibrary', async () => {
        requests++
        await delay(80)
        if (requests === 1)
          return HttpResponse.json({
            errors: [{ message: 'Internal error', extensions: { code: 'INTERNAL' } }],
          })
        state.libraries = [SHOWS]
        return HttpResponse.json(removed('movies'))
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
        return HttpResponse.json(removed('movies'))
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
    let submitted: unknown
    server.use(
      graphql.mutation('RemoveLibrary', ({ variables }) => {
        submitted = variables
        state.libraries = []
        return HttpResponse.json(removed('movies'))
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
    expect(submitted).toEqual({ input: { libraryId: 'movies' } })
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
    expect(screen.getByRole('button', { name: 'Scan library' })).toBeDisabled()
    expect(
      screen.queryByRole('heading', { name: 'Add your first library' }),
    ).not.toBeInTheDocument()
    server.use(
      graphql.query('AdminLibraries', () => HttpResponse.json({ data: { libraries: [MOVIES] } })),
    )
    await user.click(screen.getByRole('button', { name: 'Retry' }))
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

  it('shouldReadTheInventoryAgainOnceWhenTheNetworkAndThePageReturnTogether', async () => {
    const state = serve()
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    renderAppAt(SETTINGS)
    await screen.findByRole('article', { name: 'Movies settings' })
    const requests = state.inventoryRequests
    state.libraries = [{ ...MOVIES, status: 'SCANNING' }, SHOWS]

    act(() => {
      visibility = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('online'))
      visibility = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(await screen.findByRole('article', { name: 'Movies settings' })).toHaveTextContent(
      'SCANNING',
    )
    expect(state.inventoryRequests).toBe(requests + 1)
  })

  it('shouldShowUnavailableLibraryForRemovedDeepLinks', async () => {
    serve()
    renderAppAt(`${SETTINGS}?library=gone`)
    await screen.findByRole('heading', { name: 'Library unavailable' })
    expect(screen.queryByRole('button', { name: 'Remove library' })).not.toBeInTheDocument()
  })
})
