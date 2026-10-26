import { watchingConnection } from '../../test/continueWatchingFixtures'
import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, graphql, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '../../test/deferred'
import { serveGraphqlSocket } from '../../test/graphqlSocket'
import { comeBackOnline } from '../../test/graphqlResponses'
import { meFixture, profileFixture } from '../../test/meFixture'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'
import type {
  AddLibraryMutation,
  AddLibraryMutationVariables,
} from '../../graphql/generated/graphql'
import type { ManagedLibrary } from './libraryModel'

const ADMIN = meFixture({ scope: 'profile', serverAdmin: true })
// A ServerAdmin who browses with a selected Profile, so the ordinary views' live changes run too.
const VIEWING_ADMIN = meFixture({
  scope: 'profile',
  serverAdmin: true,
  profiles: [profileFixture({ selected: true })],
})
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
          continueWatching: watchingConnection([]),
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

// Each response that can show a busy status for a run the client started.
const START_RESPONSES = [
  {
    response: 'AStartedScan',
    operationName: 'StartLibraryScan',
    start: scanMovies,
    busy: 'SCANNING' as const,
    payload: {
      startLibraryScan: { library: { ...MOVIES, status: 'SCANNING' }, userErrors: [] },
    },
  },
  {
    response: 'AStartedRefresh',
    operationName: 'StartLibraryRefresh',
    start: refreshMovies,
    busy: 'REFRESHING' as const,
    payload: {
      startLibraryRefresh: { library: { ...MOVIES, status: 'REFRESHING' }, userErrors: [] },
    },
  },
  {
    response: 'ABusyRefusal',
    operationName: 'StartLibraryScan',
    start: scanMovies,
    busy: 'SCANNING' as const,
    payload: {
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
  },
]

// Each stop the panel offers, with the status the library shows while that kind runs.
const STOPS = [
  {
    kind: 'Scan',
    busy: 'SCANNING' as const,
    action: 'Stop scan',
    otherAction: 'Stop refresh',
    operationName: 'StopLibraryScan',
    field: 'stopLibraryScan',
    stopped:
      'Scan stopped. Details such as cast photos can still appear for titles the scan already processed.',
  },
  {
    kind: 'Refresh',
    busy: 'REFRESHING' as const,
    action: 'Stop refresh',
    otherAction: 'Stop scan',
    operationName: 'StopLibraryRefresh',
    field: 'stopLibraryRefresh',
    stopped:
      'Metadata refresh stopped. Details such as cast photos can still appear for titles the refresh already processed.',
  },
]

function stopping(field: string) {
  return { data: { [field]: { library: { ...MOVIES, status: 'STOPPING' }, userErrors: [] } } }
}

function moviesRow() {
  return within(screen.getByRole('navigation', { name: 'Libraries to manage' })).getByRole(
    'button',
    { name: /Movies/ },
  )
}

function panelStatus(detail: HTMLElement) {
  return detail.querySelector('[data-library-status]')?.closest('output')
}

function statusGlyph(container: HTMLElement) {
  return container.querySelector('[data-library-status] svg')?.getAttribute('class')
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

  it('shouldEnterOnceTheBrowserComesBackOnlineAfterTheAccessCheckFailed', async () => {
    serve()
    const { user } = renderAppAt('/')
    await user.click(await screen.findByRole('button', { name: /Profile menu/ }))
    server.use(graphql.query('Me', () => HttpResponse.error()))
    await user.click(screen.getByRole('button', { name: 'Server settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't confirm your access")
    server.use(graphql.query('Me', () => HttpResponse.json({ data: { me: ADMIN } })))

    comeBackOnline()

    expect(await screen.findByRole('article', { name: 'Movies settings' })).toBeInTheDocument()
    expect(screen.queryByText(/Couldn't confirm your access/)).not.toBeInTheDocument()
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

  it('shouldShowTheAddedLibraryAsScanningFromItsPayloadBeforeAnyInventoryRead', async () => {
    serve([MOVIES])
    const family = {
      ...MOVIES,
      id: 'family',
      name: 'Family',
      filepathUri: '/media/family',
      status: 'SCANNING' as const,
    }
    server.use(
      graphql.mutation('AddLibrary', () =>
        HttpResponse.json({ data: { addLibrary: { library: family, userErrors: [] } } }),
      ),
    )
    const { user } = renderAppAt(SETTINGS)
    await screen.findByRole('article', { name: 'Movies settings' })
    await user.click(screen.getByRole('link', { name: 'Add library' }))
    await user.type(await screen.findByRole('textbox', { name: /Library name/ }), 'Family')
    await user.type(screen.getByRole('textbox', { name: /Server folder/ }), '/media/family')
    // No inventory read answers: what the admin sees comes from the creation itself.
    server.use(
      graphql.query('AdminLibraries', () => delay('infinite')),
      graphql.query('Libraries', () => delay('infinite')),
    )

    await user.click(screen.getByRole('button', { name: 'Add library' }))

    const detail = await screen.findByRole('article', { name: 'Family settings' })
    expect(detail).toHaveTextContent('SCANNING')
    expect(within(detail).getByRole('button', { name: 'Scan library' })).toBeDisabled()
    const inventory = screen.getByRole('navigation', { name: 'Libraries to manage' })
    expect(within(inventory).getAllByRole('button')).toHaveLength(2)
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

  it('shouldNotShowAnEarlierScanAcknowledgementWhenALaterScanStartsElsewhere', async () => {
    const state = serve()
    server.use(
      graphql.mutation('StartLibraryScan', () => {
        const library = { ...MOVIES, status: 'SCANNING' as const }
        return HttpResponse.json({ data: { startLibraryScan: { library, userErrors: [] } } })
      }),
    )
    const { user } = renderAppAt(SETTINGS)
    await scanMovies(user)
    const detail = screen.getByRole('article', { name: 'Movies settings' })
    await within(detail).findByText('Scan requested for Movies.')
    await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
    state.socket.publish('LibraryStatusChanged', {
      data: { libraryStatusChanged: { ...MOVIES, scanCompletedOn: '2026-10-15T12:05:00Z' } },
    })
    await waitFor(() => expect(detail).toHaveTextContent('HEALTHY'))

    state.socket.publish('LibraryStatusChanged', {
      data: {
        libraryStatusChanged: {
          ...MOVIES,
          status: 'SCANNING',
          scanStartedOn: '2026-10-15T13:00:00Z',
          scanCompletedOn: '2026-10-15T12:05:00Z',
        },
      },
    })

    await waitFor(() => expect(detail).toHaveTextContent('SCANNING'))
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

    await refreshMovies(user)

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

    await refreshMovies(user)

    const detail = screen.getByRole('article', { name: 'Movies settings' })
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

  it.each(START_RESPONSES)(
    'shouldKeepTheLiveStatusWhenTheRunEndsBeforeTheResponseTo$response',
    async ({ operationName, start, busy, payload }) => {
      const state = serve()
      const requested = deferred()
      const answer = deferred()
      server.use(
        graphql.mutation(operationName, async () => {
          requested.resolve()
          await answer.promise
          return HttpResponse.json({ data: payload })
        }),
      )
      const { user } = renderAppAt(SETTINGS)
      await screen.findByRole('article', { name: 'Movies settings' })
      await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
      await start(user)
      await requested.promise
      const detail = screen.getByRole('article', { name: 'Movies settings' })
      state.socket.publish('LibraryStatusChanged', {
        data: { libraryStatusChanged: { ...MOVIES, status: busy } },
      })
      await waitFor(() => expect(detail).toHaveTextContent(busy))
      state.socket.publish('LibraryStatusChanged', {
        data: { libraryStatusChanged: { ...MOVIES, scanCompletedOn: '2026-10-15T12:05:00Z' } },
      })
      await waitFor(() => expect(detail).toHaveTextContent('HEALTHY'))

      answer.resolve()

      const scan = within(detail).getByRole('button', { name: 'Scan library' })
      await waitFor(() => expect(scan).toBeEnabled())
      expect(detail).toHaveTextContent('HEALTHY')
    },
  )

  it.each(START_RESPONSES)(
    'shouldKeepTheStatusReadAfterAReconnectWhenTheRunEndsUnseenBeforeTheResponseTo$response',
    async ({ operationName, start, payload }) => {
      const state = serve()
      const requested = deferred()
      const answer = deferred()
      server.use(
        graphql.mutation(operationName, async () => {
          requested.resolve()
          await answer.promise
          return HttpResponse.json({ data: payload })
        }),
      )
      const { user } = renderAppAt(SETTINGS)
      const detail = await screen.findByRole('article', { name: 'Movies settings' })
      await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
      await start(user)
      await requested.promise
      const requests = state.inventoryRequests
      state.libraries = [{ ...MOVIES, scanCompletedOn: '2026-10-15T12:05:00Z' }, SHOWS]

      state.socket.closeAll(1001, 'Going away')
      await waitFor(() => expect(state.inventoryRequests).toBe(requests + 1), { timeout: 3_000 })
      await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
      answer.resolve()

      const scan = within(detail).getByRole('button', { name: 'Scan library' })
      await waitFor(() => expect(scan).toBeEnabled())
      expect(detail).toHaveTextContent('HEALTHY')
    },
  )

  it.each(START_RESPONSES)(
    'shouldReadAgainWhenTheReadAfterAReconnectCameBeforeTheResponseTo$response',
    async ({ operationName, start, busy, payload }) => {
      const state = serve()
      const requested = deferred()
      const answer = deferred()
      server.use(
        graphql.mutation(operationName, async () => {
          requested.resolve()
          await answer.promise
          return HttpResponse.json({ data: payload })
        }),
      )
      const { user } = renderAppAt(SETTINGS)
      const detail = await screen.findByRole('article', { name: 'Movies settings' })
      await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
      await start(user)
      await requested.promise
      const requests = state.inventoryRequests

      state.socket.closeAll(1001, 'Going away')
      await waitFor(() => expect(state.inventoryRequests).toBe(requests + 1), { timeout: 3_000 })
      await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
      state.libraries = [{ ...MOVIES, status: busy }, SHOWS]
      answer.resolve()

      await waitFor(() => expect(state.inventoryRequests).toBe(requests + 2))
      await waitFor(() => expect(detail).toHaveTextContent(busy))
      expect(within(detail).getByRole('button', { name: 'Scan library' })).toBeDisabled()
    },
  )

  it.each(START_RESPONSES)(
    'shouldReadAgainAfterAReconnectReadThatStillRunsWhenTheResponseTo$response',
    async ({ operationName, start, busy, payload }) => {
      const state = serve()
      const requested = deferred()
      const answer = deferred()
      const reconnectReadHeld = deferred()
      server.use(
        graphql.mutation(operationName, async () => {
          requested.resolve()
          await answer.promise
          return HttpResponse.json({ data: payload })
        }),
      )
      const { user } = renderAppAt(SETTINGS)
      const detail = await screen.findByRole('article', { name: 'Movies settings' })
      await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
      await start(user)
      await requested.promise
      const requests = state.inventoryRequests
      server.use(
        graphql.query(
          'AdminLibraries',
          async () => {
            state.inventoryRequests++
            const snapshot = state.libraries
            await reconnectReadHeld.promise
            return HttpResponse.json({ data: { libraries: snapshot } })
          },
          { once: true },
        ),
      )

      state.socket.closeAll(1001, 'Going away')
      await waitFor(() => expect(state.inventoryRequests).toBe(requests + 1), { timeout: 3_000 })
      await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
      state.libraries = [{ ...MOVIES, status: busy }, SHOWS]
      const responseDelivered = new Promise<void>((resolve) => {
        const delivered = () => {
          server.events.removeListener('response:mocked', delivered)
          resolve()
        }
        server.events.on('response:mocked', delivered)
      })
      answer.resolve()
      await responseDelivered
      await new Promise((resolve) => setTimeout(resolve))
      reconnectReadHeld.resolve()

      await waitFor(() => expect(state.inventoryRequests).toBe(requests + 2))
      await waitFor(() => expect(detail).toHaveTextContent(busy))
      expect(within(detail).getByRole('button', { name: 'Scan library' })).toBeDisabled()
    },
  )

  it.each([
    {
      operationName: 'StartLibraryScan',
      start: scanMovies,
      busy: 'SCANNING' as const,
      payload: {
        startLibraryScan: { library: { ...MOVIES, status: 'SCANNING' }, userErrors: [] },
      },
    },
    {
      operationName: 'StartLibraryRefresh',
      start: refreshMovies,
      busy: 'REFRESHING' as const,
      payload: {
        startLibraryRefresh: { library: { ...MOVIES, status: 'REFRESHING' }, userErrors: [] },
      },
    },
  ])(
    'shouldNotAcknowledgeALaterRunWhenTheRunEndedBeforeTheResponseTo$operationName',
    async ({ operationName, start, busy, payload }) => {
      const state = serve()
      const requested = deferred()
      const answer = deferred()
      server.use(
        graphql.mutation(operationName, async () => {
          requested.resolve()
          await answer.promise
          return HttpResponse.json({ data: payload })
        }),
      )
      const { user } = renderAppAt(SETTINGS)
      await screen.findByRole('article', { name: 'Movies settings' })
      await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
      await start(user)
      await requested.promise
      const detail = screen.getByRole('article', { name: 'Movies settings' })
      state.socket.publish('LibraryStatusChanged', {
        data: { libraryStatusChanged: { ...MOVIES, scanCompletedOn: '2026-10-15T12:05:00Z' } },
      })
      answer.resolve()
      const scan = within(detail).getByRole('button', { name: 'Scan library' })
      await waitFor(() => expect(scan).toBeEnabled())

      state.socket.publish('LibraryStatusChanged', {
        data: { libraryStatusChanged: { ...MOVIES, status: busy } },
      })

      await waitFor(() => expect(detail).toHaveTextContent(busy))
      expect(detail).not.toHaveTextContent('requested for Movies')
    },
  )

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

  it.each([
    { answer: 'NoPayload', body: { data: { startLibraryScan: null } } },
    {
      answer: 'APayloadWithoutALibrary',
      body: { data: { startLibraryScan: { library: null, userErrors: [] } } },
    },
  ])('shouldSayTheScanIsUnconfirmedWhenTheServerAnswersWith$answer', async ({ body }) => {
    serve()
    server.use(graphql.mutation('StartLibraryScan', () => HttpResponse.json(body)))
    const { user } = renderAppAt(SETTINGS)

    await scanMovies(user)

    const detail = screen.getByRole('article', { name: 'Movies settings' })
    expect(await within(detail).findByRole('alert')).toHaveTextContent(
      "Couldn't confirm the operation",
    )
    expect(detail).toHaveTextContent('HEALTHY')
  })

  it('shouldSayThePermissionIsGoneWhenTheServerForbidsAScan', async () => {
    serve()
    server.use(
      graphql.mutation('StartLibraryScan', () =>
        HttpResponse.json({
          data: { startLibraryScan: null },
          errors: [
            { message: 'Forbidden', path: ['startLibraryScan'], extensions: { code: 'FORBIDDEN' } },
          ],
        }),
      ),
    )
    const { user } = renderAppAt(SETTINGS)

    await scanMovies(user)

    const detail = screen.getByRole('article', { name: 'Movies settings' })
    expect(await within(detail).findByRole('alert')).toHaveTextContent(
      'You no longer have permission to manage libraries.',
    )
  })

  it('shouldKeepTheLibraryWhenARemovalAnswersWithoutTheRemovedId', async () => {
    serve()
    server.use(
      graphql.mutation('RemoveLibrary', () =>
        HttpResponse.json({ data: { removeLibrary: { removedLibraryId: null, userErrors: [] } } }),
      ),
    )
    const { user } = renderAppAt(SETTINGS)
    await user.click(await screen.findByRole('button', { name: 'Remove library' }))

    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove library' }),
    )

    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      "Couldn't confirm the operation",
    )
    expect(screen.getByRole('article', { name: 'Movies settings' })).toBeInTheDocument()
  })

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

  it('shouldDropALibraryAnotherSessionRemovedFromTheInventoryAndTheTopBar', async () => {
    const state = serve([MOVIES, SHOWS], VIEWING_ADMIN)
    renderAppAt(SETTINGS)
    await screen.findByRole('article', { name: 'Movies settings' })
    const primary = screen.getByRole('navigation', { name: 'Primary' })
    const inventory = screen.getByRole('navigation', { name: 'Libraries to manage' })
    await within(primary).findByRole('link', { name: 'TV shows' })
    await waitFor(() => expect(state.socket.isLive('LibraryRemoved')).toBe(true))

    state.libraries = [MOVIES]
    state.socket.publish('LibraryRemoved', {
      data: { libraryRemoved: { __typename: 'LibraryRemoval', libraryId: 'shows' } },
    })

    await waitFor(() =>
      expect(within(inventory).queryByRole('button', { name: /TV shows/ })).not.toBeInTheDocument(),
    )
    expect(within(primary).queryByRole('link', { name: 'TV shows' })).not.toBeInTheDocument()
    expect(within(primary).getByRole('link', { name: 'Movies' })).toBeInTheDocument()
  })

  it.each([
    { operationName: 'LibraryStatusChanged', field: 'libraryStatusChanged' },
    { operationName: 'LibraryAdded', field: 'libraryAdded' },
    { operationName: 'LibraryRemoved', field: 'libraryRemoved' },
  ])(
    'shouldKeepLiveStatusAndReadTheInventoryAgainWhenAChangeArrivesAsNull $field',
    async ({ operationName, field }) => {
      const state = serve()
      renderAppAt(SETTINGS)
      const detail = await screen.findByRole('article', { name: 'Movies settings' })
      await waitFor(() => expect(state.socket.isLive(operationName)).toBe(true))
      const requests = state.inventoryRequests
      state.libraries = [{ ...MOVIES, status: 'REFRESHING' }, SHOWS]

      state.socket.publish(operationName, {
        data: { [field]: null },
        errors: [{ message: 'Library unavailable', path: [field] }],
      })

      await waitFor(() => expect(detail).toHaveTextContent('REFRESHING'))
      expect(state.inventoryRequests).toBe(requests + 1)
      state.socket.publish('LibraryStatusChanged', {
        data: { libraryStatusChanged: { ...MOVIES, status: 'SCANNING' } },
      })
      await waitFor(() => expect(detail).toHaveTextContent('SCANNING'))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )

  it('shouldListAnAddedLibraryWhoseChangeCarriesAFailedFieldBeforeTheInventoryReadsAgain', async () => {
    const state = serve()
    renderAppAt(SETTINGS)
    await screen.findByRole('article', { name: 'Movies settings' })
    await waitFor(() => expect(state.socket.isLive('LibraryAdded')).toBe(true))
    const readAgain = deferred()
    server.use(
      graphql.query('AdminLibraries', async () => {
        state.inventoryRequests++
        await readAgain.promise
        return HttpResponse.json({ data: { libraries: state.libraries } })
      }),
    )
    const family = { ...MOVIES, id: 'family', name: 'Family', scanStartedOn: null }
    state.libraries = [MOVIES, SHOWS, family]

    state.socket.publish('LibraryAdded', {
      data: { libraryAdded: family },
      errors: [{ message: 'Scan start unavailable', path: ['libraryAdded', 'scanStartedOn'] }],
    })

    const inventory = screen.getByRole('navigation', { name: 'Libraries to manage' })
    await within(inventory).findByRole('button', { name: /Family/ })
    readAgain.resolve()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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
    const detail = await screen.findByRole('article', { name: 'Movies settings' })
    const requests = state.inventoryRequests
    state.libraries = [{ ...MOVIES, status: 'SCANNING' }, SHOWS]

    act(() => {
      visibility = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('online'))
      visibility = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => expect(detail).toHaveTextContent('SCANNING'))
    expect(state.inventoryRequests).toBe(requests + 1)
  })

  it('shouldShowUnavailableLibraryForRemovedDeepLinks', async () => {
    serve()
    renderAppAt(`${SETTINGS}?library=gone`)
    await screen.findByRole('heading', { name: 'Library unavailable' })
    expect(screen.queryByRole('button', { name: 'Remove library' })).not.toBeInTheDocument()
  })

  describe('stopping a scan or refresh', () => {
    it.each(STOPS)(
      'shouldShowStoppingFromThePayloadWhenTheStopIsChosenDuringA$kind',
      async ({ busy, action, operationName, field }) => {
        const state = serve([{ ...MOVIES, status: busy }, SHOWS])
        let submitted: unknown
        server.use(
          graphql.mutation(operationName, ({ variables }) => {
            submitted = variables
            return HttpResponse.json(stopping(field))
          }),
        )
        const { user } = renderAppAt(SETTINGS)
        const detail = await screen.findByRole('article', { name: 'Movies settings' })
        await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
        const requests = state.inventoryRequests

        await user.click(within(detail).getByRole('button', { name: action }))

        await waitFor(() => expect(detail).toHaveTextContent('STOPPING'))
        expect(moviesRow()).toHaveTextContent('STOPPING')
        expect(submitted).toEqual({ input: { libraryId: 'movies' } })
        expect(state.inventoryRequests).toBe(requests)
      },
    )

    it.each(STOPS)(
      'shouldSendOneStopWhenTheStopIsChosenAgainWhileTheFirstIsInFlightDuringA$kind',
      async ({ busy, action, operationName, field }) => {
        serve([{ ...MOVIES, status: busy }, SHOWS])
        const requested = deferred()
        const answer = deferred()
        let stopRequests = 0
        server.use(
          graphql.mutation(operationName, async () => {
            stopRequests++
            requested.resolve()
            await answer.promise
            return HttpResponse.json(stopping(field))
          }),
        )
        const { user } = renderAppAt(SETTINGS)
        const detail = await screen.findByRole('article', { name: 'Movies settings' })
        const stop = within(detail).getByRole('button', { name: action })
        await user.click(stop)
        await requested.promise

        await user.click(stop)
        answer.resolve()

        await waitFor(() => expect(detail).toHaveTextContent('STOPPING'))
        expect(stopRequests).toBe(1)
      },
    )

    it.each(STOPS)(
      'shouldKeepTheEarlierStatusWithoutReadingTheInventoryWhenTheStopEndsBeforeTheResponseToStoppingA$kind',
      async ({ busy, action, operationName, field }) => {
        const state = serve([{ ...MOVIES, status: busy }, SHOWS])
        const requested = deferred()
        const answer = deferred()
        server.use(
          graphql.mutation(operationName, async () => {
            requested.resolve()
            await answer.promise
            return HttpResponse.json(stopping(field))
          }),
        )
        const { user } = renderAppAt(SETTINGS)
        const detail = await screen.findByRole('article', { name: 'Movies settings' })
        await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
        const requests = state.inventoryRequests
        await user.click(within(detail).getByRole('button', { name: action }))
        await requested.promise
        state.socket.publish('LibraryStatusChanged', {
          data: { libraryStatusChanged: { ...MOVIES, status: 'STOPPING' } },
        })
        await waitFor(() => expect(detail).toHaveTextContent('STOPPING'))
        state.socket.publish('LibraryStatusChanged', {
          data: { libraryStatusChanged: { ...MOVIES, status: 'UNHEALTHY' } },
        })
        await waitFor(() => expect(detail).toHaveTextContent('UNHEALTHY'))
        const scan = within(detail).getByRole('button', { name: 'Scan library' })
        expect(scan).toBeDisabled()

        answer.resolve()

        await waitFor(() => expect(scan).toBeEnabled())
        expect(detail.querySelector('[data-library-status]')).toHaveTextContent(/^UNHEALTHY$/)
        expect(moviesRow()).toHaveTextContent('UNHEALTHY')
        expect(state.inventoryRequests).toBe(requests)
      },
    )

    it.each([
      { status: 'HEALTHY' as const, offered: [] },
      { status: 'UNHEALTHY' as const, offered: [] },
      { status: 'SCANNING' as const, offered: ['Stop scan'] },
      { status: 'REFRESHING' as const, offered: ['Stop refresh'] },
      { status: 'STOPPING' as const, offered: [] },
    ])(
      'shouldOfferOnlyTheStopForTheRunningKindWhileTheLibraryShows$status',
      async ({ status, offered }) => {
        serve([{ ...MOVIES, status }, SHOWS])
        renderAppAt(SETTINGS)
        const detail = await screen.findByRole('article', { name: 'Movies settings' })

        const stops = within(detail)
          .queryAllByRole('button', { name: /^Stop / })
          .map((button) => button.textContent)

        expect(stops).toEqual(offered)
      },
    )

    it.each(STOPS)(
      'shouldDescribeWhatAStopKeepsBesideTheStopForA$kind',
      async ({ busy, action }) => {
        serve([{ ...MOVIES, status: busy }, SHOWS])
        renderAppAt(SETTINGS)
        const detail = await screen.findByRole('article', { name: 'Movies settings' })

        const stop = within(detail).getByRole('button', { name: action })

        expect(stop).toBeEnabled()
        expect(stop).toHaveAccessibleDescription(/finish\. Nothing is rolled back/)
      },
    )

    it('shouldDisableStopWhenTheLatestLibraryStateFailedToLoad', async () => {
      serve([{ ...MOVIES, status: 'SCANNING' }, SHOWS])
      const { router } = renderAppAt(SETTINGS)
      await screen.findByRole('article', { name: 'Movies settings' })
      await act(() => router.navigate({ to: '/' }))
      server.use(
        graphql.query('AdminLibraries', () =>
          HttpResponse.json({ errors: [{ message: 'offline' }] }),
        ),
      )

      await act(() => router.navigate({ to: SETTINGS }))

      await screen.findByRole('alert')
      expect(screen.getByRole('button', { name: 'Stop scan' })).toBeDisabled()
    })

    it('shouldDisableEveryLibraryActionWhileTheLibraryShowsStopping', async () => {
      serve([{ ...MOVIES, status: 'STOPPING' }, SHOWS])
      renderAppAt(SETTINGS)
      const detail = await screen.findByRole('article', { name: 'Movies settings' })
      expect(detail.querySelector('[data-library-status]')).toHaveTextContent('STOPPING')

      for (const name of ['Scan library', 'Refresh metadata', 'Remove library'])
        expect(within(detail).getByRole('button', { name })).toBeDisabled()
      expect(within(detail).queryByRole('button', { name: /^Stop / })).not.toBeInTheDocument()
      expect(within(detail).getByRole('link', { name: 'View library' })).toBeInTheDocument()
    })

    it('shouldShowStoppingVerbatimWithItsOwnIconInTheListAndThePanel', async () => {
      const statuses = ['HEALTHY', 'SCANNING', 'REFRESHING', 'UNHEALTHY', 'FUTURE_STATE']
      const others = statuses.map((status) => ({
        ...MOVIES,
        id: status,
        name: `Library ${status}`,
        status: status as ManagedLibrary['status'],
      }))
      serve([{ ...MOVIES, status: 'STOPPING' }, ...others])
      renderAppAt(SETTINGS)
      const detail = await screen.findByRole('article', { name: 'Movies settings' })
      const inventory = screen.getByRole('navigation', { name: 'Libraries to manage' })

      const otherGlyphs = statuses.map((status) =>
        statusGlyph(
          within(inventory).getByRole('button', { name: new RegExp(`^Library ${status}`) }),
        ),
      )

      expect(detail.querySelector('[data-library-status]')).toHaveTextContent(/^STOPPING$/)
      expect(moviesRow().querySelector('[data-library-status]')).toHaveTextContent(/^STOPPING$/)
      expect(statusGlyph(detail)).toBeTruthy()
      expect(statusGlyph(moviesRow())).toBe(statusGlyph(detail))
      expect(otherGlyphs).not.toContain(statusGlyph(detail))
    })

    // ICONOGRAPHY.md approves one stop glyph, a square inside a circle, for STOPPING and Stop.
    it.each(STOPS)(
      'shouldShowTheStoppingGlyphAsADecorativeSquareInACircleBesideTheStopForA$kind',
      async ({ busy, action }) => {
        serve([
          { ...MOVIES, status: busy },
          { ...SHOWS, status: 'STOPPING' },
        ])
        renderAppAt(SETTINGS)
        const detail = await screen.findByRole('article', { name: 'Movies settings' })
        const inventory = screen.getByRole('navigation', { name: 'Libraries to manage' })

        const stopGlyph = within(detail).getByRole('button', { name: action }).querySelector('svg')
        const stoppingGlyph = within(inventory)
          .getByRole('button', { name: /^TV shows/ })
          .querySelector('[data-library-status] svg')

        expect(stopGlyph).toHaveAttribute('aria-hidden', 'true')
        expect(stopGlyph?.innerHTML).toBe(stoppingGlyph?.innerHTML)
        expect(stopGlyph?.querySelectorAll('circle')).toHaveLength(1)
        expect(stopGlyph?.querySelectorAll('rect')).toHaveLength(1)
        expect(stopGlyph).toHaveAttribute('fill', 'none')
      },
    )

    it.each([
      {
        refusal: 'LibraryScanNotInProgressError',
        operationName: 'StopLibraryScan',
        field: 'stopLibraryScan',
        action: 'Stop scan',
        busy: 'SCANNING' as const,
        message:
          'No library scan is in progress, so there is nothing to stop. A library refresh is in progress.',
        carried: 'REFRESHING' as const,
        offered: 'Stop refresh',
      },
      {
        refusal: 'LibraryRefreshNotInProgressError',
        operationName: 'StopLibraryRefresh',
        field: 'stopLibraryRefresh',
        action: 'Stop refresh',
        busy: 'REFRESHING' as const,
        message:
          'No library refresh is in progress, so there is nothing to stop. A library scan is in progress.',
        carried: 'SCANNING' as const,
        offered: 'Stop scan',
      },
    ])(
      'shouldShowTheServerMessageAndTheStatusCarriedBy$refusal',
      async ({ refusal, operationName, field, action, busy, message, carried, offered }) => {
        serve([{ ...MOVIES, status: busy }, SHOWS])
        server.use(
          graphql.mutation(operationName, () =>
            HttpResponse.json({
              data: {
                [field]: {
                  library: null,
                  userErrors: [{ __typename: refusal, message, status: carried }],
                },
              },
            }),
          ),
        )
        const { user } = renderAppAt(SETTINGS)
        const detail = await screen.findByRole('article', { name: 'Movies settings' })

        await user.click(within(detail).getByRole('button', { name: action }))

        expect(await within(detail).findByRole('alert')).toHaveTextContent(message)
        await waitFor(() => expect(detail).toHaveTextContent(carried))
        expect(within(detail).getByRole('button', { name: offered })).toBeEnabled()
      },
    )

    it.each(STOPS)(
      'shouldSayTheRunStoppedAndThatDetailsCanStillArriveOnceTheLibraryLeavesStoppingAfterA$kind',
      async ({ busy, action, operationName, field, stopped }) => {
        const state = serve([{ ...MOVIES, status: busy }, SHOWS])
        server.use(graphql.mutation(operationName, () => HttpResponse.json(stopping(field))))
        const { user } = renderAppAt(SETTINGS)
        const detail = await screen.findByRole('article', { name: 'Movies settings' })
        await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
        await user.click(within(detail).getByRole('button', { name: action }))
        await waitFor(() => expect(detail).toHaveTextContent('STOPPING'))
        expect(detail).not.toHaveTextContent(stopped)

        state.socket.publish('LibraryStatusChanged', { data: { libraryStatusChanged: MOVIES } })

        expect(await within(detail).findByText(stopped)).toBeInTheDocument()
        expect(detail).toHaveTextContent('HEALTHY')
      },
    )

    it('shouldSayTheScanStoppedWhenAnotherSessionStoppedIt', async () => {
      const state = serve([{ ...MOVIES, status: 'SCANNING' }, SHOWS])
      renderAppAt(SETTINGS)
      const detail = await screen.findByRole('article', { name: 'Movies settings' })
      await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
      state.socket.publish('LibraryStatusChanged', {
        data: { libraryStatusChanged: { ...MOVIES, status: 'STOPPING' } },
      })
      await waitFor(() => expect(detail).toHaveTextContent('STOPPING'))

      state.socket.publish('LibraryStatusChanged', { data: { libraryStatusChanged: MOVIES } })

      expect(await within(detail).findByText(STOPS[0].stopped)).toBeInTheDocument()
    })

    it('shouldSayTheRunStoppedWithoutNamingItsKindWhenThePanelFirstShowedStopping', async () => {
      const state = serve([{ ...MOVIES, status: 'STOPPING' }, SHOWS])
      renderAppAt(SETTINGS)
      const detail = await screen.findByRole('article', { name: 'Movies settings' })
      await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))

      state.socket.publish('LibraryStatusChanged', {
        data: { libraryStatusChanged: { ...MOVIES, status: 'UNHEALTHY' } },
      })

      expect(
        await within(detail).findByText(
          'Scan or metadata refresh stopped. Details such as cast photos can still appear for titles already processed.',
        ),
      ).toBeInTheDocument()
    })

    it('shouldNotSayTheScanStoppedWhenTheReadAfterAReconnectFindsANewScanRunning', async () => {
      const state = serve([{ ...MOVIES, status: 'SCANNING' }, SHOWS])
      renderAppAt(SETTINGS)
      const detail = await screen.findByRole('article', { name: 'Movies settings' })
      await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
      state.socket.publish('LibraryStatusChanged', {
        data: { libraryStatusChanged: { ...MOVIES, status: 'STOPPING' } },
      })
      await waitFor(() => expect(detail).toHaveTextContent('STOPPING'))
      const requests = state.inventoryRequests
      // The stop finished and another session started a new scan while the socket was closed.
      state.libraries = [{ ...MOVIES, status: 'SCANNING' }, SHOWS]

      state.socket.closeAll(1012, 'Service restart')

      await waitFor(() => expect(state.inventoryRequests).toBe(requests + 1), { timeout: 3_000 })
      await waitFor(() => expect(detail).toHaveTextContent('SCANNING'))
      expect(within(detail).getByRole('button', { name: 'Stop scan' })).toBeEnabled()
      expect(detail).not.toHaveTextContent(STOPS[0].stopped)
    })

    it('shouldDropTheStoppedNoteWhenTheLibraryStatusChangesAgain', async () => {
      const state = serve([{ ...MOVIES, status: 'SCANNING' }, SHOWS])
      renderAppAt(SETTINGS)
      const detail = await screen.findByRole('article', { name: 'Movies settings' })
      await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
      state.socket.publish('LibraryStatusChanged', {
        data: { libraryStatusChanged: { ...MOVIES, status: 'STOPPING' } },
      })
      await waitFor(() => expect(detail).toHaveTextContent('STOPPING'))
      state.socket.publish('LibraryStatusChanged', { data: { libraryStatusChanged: MOVIES } })
      await within(detail).findByText(STOPS[0].stopped)

      state.socket.publish('LibraryStatusChanged', {
        data: { libraryStatusChanged: { ...MOVIES, status: 'REFRESHING' } },
      })

      await waitFor(() => expect(detail).toHaveTextContent('REFRESHING'))
      expect(detail).not.toHaveTextContent(STOPS[0].stopped)
    })

    it('shouldNotSayARunStoppedWhenItFinishesWithoutAStop', async () => {
      const state = serve([{ ...MOVIES, status: 'SCANNING' }, SHOWS])
      renderAppAt(SETTINGS)
      const detail = await screen.findByRole('article', { name: 'Movies settings' })
      await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))

      state.socket.publish('LibraryStatusChanged', { data: { libraryStatusChanged: MOVIES } })

      await waitFor(() => expect(detail).toHaveTextContent('HEALTHY'))
      expect(detail).not.toHaveTextContent('stopped')
    })

    it.each(STOPS)(
      'shouldMoveFocusToThePanelStatusWhenTheChosenStopLeavesDuringA$kind',
      async ({ busy, action, operationName, field }) => {
        serve([{ ...MOVIES, status: busy }, SHOWS])
        server.use(graphql.mutation(operationName, () => HttpResponse.json(stopping(field))))
        const { user } = renderAppAt(SETTINGS)
        const detail = await screen.findByRole('article', { name: 'Movies settings' })

        await user.click(within(detail).getByRole('button', { name: action }))

        await waitFor(() => expect(detail).toHaveTextContent('STOPPING'))
        await waitFor(() => expect(panelStatus(detail)).toHaveFocus())
      },
    )

    it('shouldMoveFocusToThePanelStatusWhenAnotherSessionsStopRemovesTheFocusedStop', async () => {
      const state = serve([{ ...MOVIES, status: 'SCANNING' }, SHOWS])
      renderAppAt(SETTINGS)
      const detail = await screen.findByRole('article', { name: 'Movies settings' })
      await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
      act(() => within(detail).getByRole('button', { name: 'Stop scan' }).focus())

      state.socket.publish('LibraryStatusChanged', {
        data: { libraryStatusChanged: { ...MOVIES, status: 'STOPPING' } },
      })

      await waitFor(() => expect(detail).toHaveTextContent('STOPPING'))
      await waitFor(() => expect(panelStatus(detail)).toHaveFocus())
    })

    it('shouldLeaveFocusWhereItIsWhenTheStopLeavesWhileAnotherControlHasFocus', async () => {
      const state = serve([{ ...MOVIES, status: 'SCANNING' }, SHOWS])
      renderAppAt(SETTINGS)
      const detail = await screen.findByRole('article', { name: 'Movies settings' })
      await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
      const view = within(detail).getByRole('link', { name: 'View library' })
      act(() => view.focus())

      state.socket.publish('LibraryStatusChanged', {
        data: { libraryStatusChanged: { ...MOVIES, status: 'STOPPING' } },
      })

      await waitFor(() => expect(detail).toHaveTextContent('STOPPING'))
      expect(view).toHaveFocus()
    })

    it('shouldLeaveFocusAloneWhenThePanelOpensWithoutAStop', async () => {
      serve([{ ...MOVIES, status: 'STOPPING' }, SHOWS])
      renderAppAt(SETTINGS)

      const detail = await screen.findByRole('article', { name: 'Movies settings' })

      expect(panelStatus(detail)).not.toHaveFocus()
    })

    it('shouldShowStoppingAndThenTheRestoredStatusWhenAnotherSessionStopsTheScan', async () => {
      const state = serve([{ ...MOVIES, status: 'SCANNING' }, SHOWS])
      renderAppAt(SETTINGS)
      const detail = await screen.findByRole('article', { name: 'Movies settings' })
      await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))

      state.socket.publish('LibraryStatusChanged', {
        data: { libraryStatusChanged: { ...MOVIES, status: 'STOPPING' } },
      })
      await waitFor(() => expect(detail).toHaveTextContent('STOPPING'))
      expect(within(detail).queryByRole('button', { name: 'Stop scan' })).not.toBeInTheDocument()
      expect(within(detail).getByRole('button', { name: 'Scan library' })).toBeDisabled()
      state.socket.publish('LibraryStatusChanged', {
        data: { libraryStatusChanged: MOVIES },
      })

      await waitFor(() => expect(detail).toHaveTextContent('HEALTHY'))
      expect(within(detail).getByRole('button', { name: 'Scan library' })).toBeEnabled()
    })

    it.each([
      { restored: 'StillStopping', current: 'STOPPING' as const, next: 'HEALTHY' as const },
      { restored: 'AlreadyRestored', current: 'UNHEALTHY' as const, next: 'SCANNING' as const },
    ])(
      'shouldReadTheCurrentStatusAfterAReconnectDuringStoppingAndFollowLaterChangesWhen$restored',
      async ({ current, next }) => {
        const state = serve([{ ...MOVIES, status: 'STOPPING' }, SHOWS])
        renderAppAt(SETTINGS)
        const detail = await screen.findByRole('article', { name: 'Movies settings' })
        expect(detail).toHaveTextContent('STOPPING')
        await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
        const requests = state.inventoryRequests
        state.libraries = [{ ...MOVIES, status: current }, SHOWS]

        state.socket.closeAll(1012, 'Service restart')

        await waitFor(() => expect(state.inventoryRequests).toBe(requests + 1), { timeout: 3_000 })
        await waitFor(() => expect(detail).toHaveTextContent(current))
        await waitFor(() => expect(state.socket.isLive('LibraryStatusChanged')).toBe(true))
        state.socket.publish('LibraryStatusChanged', {
          data: { libraryStatusChanged: { ...MOVIES, status: next } },
        })
        await waitFor(() => expect(detail).toHaveTextContent(next))
      },
    )
  })
})
