import { act, screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type {
  MarkPlaybackReportReadMutationVariables,
  PlaybackReportQuery,
  PlaybackReportsQueryVariables,
} from '../../graphql/generated/graphql'
import { deferred } from '../../test/deferred'
import { serveGraphqlSocket } from '../../test/graphqlSocket'
import { meFixture, profileFixture } from '../../test/meFixture'
import { H264_FULL_HD, playbackDecision, servedDecision } from '../../test/playbackSession'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'

const ADMIN = meFixture({ scope: 'profile', serverAdmin: true })
const REPORTS = '/settings/server/reports'

// A selection as the server sends it, each object naming its type for Apollo's cache.
type Served<Value> = Value extends readonly (infer Item)[]
  ? Served<Item>[]
  : Value extends object
    ? { [Key in keyof Value]: Served<Value[Key]> } & { __typename?: string }
    : Value

type Report = Served<NonNullable<PlaybackReportQuery['playbackReport']>>

const HEVC_UHD = { ...H264_FULL_HD, codec: 'hevc', width: 3840, height: 2160, bitrate: 40_000_000 }

// A report that a web client shared about a playback session whose initial format attempt copies.
function reportFixture(overrides: Partial<Report> = {}): Report {
  return {
    __typename: 'PlaybackReport',
    id: 'report-1',
    sharedAt: '2026-11-04T18:30:00Z',
    readAt: null,
    profileName: 'Robin',
    note: 'Stutters after every seek',
    playbackSessionId: 'playback-1',
    streamSessionId: 'sess-1',
    mediaFileId: 'file-1',
    requestedChoice: 'AUTO',
    playbackChoice: 'AUTO',
    decisions: [servedDecision(playbackDecision({ streamSessionId: 'sess-1' }))],
    player: {
      __typename: 'PlayerFigures',
      qualityStep: {
        __typename: 'PlayerQualityStep',
        number: 2,
        count: 3,
        height: 720,
        bitrate: 3_000_000,
      },
      observedBitrate: 12_500_000,
      bufferSeconds: 8,
      droppedFrames: 3,
      stalls: 1,
      resolution: { __typename: 'PictureSize', width: 1280, height: 720 },
      videoCodec: 'avc1.64001f',
      hdrMode: 'SDR',
      audio: { __typename: 'PlayerAudio', codec: 'mp4a.40.2', channels: 2, dolbyAtmos: false },
      display: null,
      audioOutput: null,
      screen: { __typename: 'PlayerScreen', width: 2560, height: 1440, pixelRatio: 2, hdr: true },
      browser: { __typename: 'PlayerBrowser', name: 'Chrome', version: '141' },
    },
    capabilityDeclaration: {
      __typename: 'ClientCapabilityDeclaration',
      video: [
        {
          __typename: 'VideoCapabilityEntry',
          codecFamily: 'HEVC',
          codecProfiles: [
            {
              __typename: 'VideoCodecProfileCapability',
              profile: 'HEVC_MAIN_10',
              maxLevel: 51,
              maxTier: 'MAIN',
            },
          ],
          maxBitDepth: 10,
          maxWidth: 3840,
          maxHeight: 2160,
          maxFrameRate: 60,
          compatibleBases: ['SDR', 'PQ'],
          dolbyVisionProfiles: [
            { __typename: 'DolbyVisionProfileCapability', profile: 'PROFILE_8_1', maxLevel: 6 },
          ],
          hdr10Plus: false,
          hls: true,
          directPlayContainers: ['MP4'],
          directPlaySampleEntries: ['HVC1'],
        },
      ],
      audio: [
        {
          __typename: 'AudioCapabilityEntry',
          codec: 'AAC',
          maxChannels: 6,
          hls: true,
          directPlayContainers: [],
        },
      ],
    },
    ...overrides,
  }
}

function summaryOf({ id, sharedAt, readAt, profileName, note }: Report) {
  return { __typename: 'PlaybackReport', id, sharedAt, readAt, profileName, note }
}

interface ServedReports {
  reports: Report[]
  pageSize?: number
}

// Serves the reports newest first, `pageSize` at a time, and their unread count; a report read
// marks it read.
function serveReports({ reports, pageSize = reports.length }: ServedReports) {
  const state = {
    reports,
    pageReads: [] as PlaybackReportsQueryVariables[],
    marked: [] as string[],
  }
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: ADMIN } })),
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('PlaybackReports', ({ variables }) => {
      const read = variables as PlaybackReportsQueryVariables
      state.pageReads.push(read)
      const start = read.after ? Number(read.after) : 0
      const page = state.reports.slice(start, start + pageSize)
      return HttpResponse.json({
        data: {
          playbackReports: {
            __typename: 'PlaybackReportConnection',
            edges: page.map((report, index) => ({
              __typename: 'PlaybackReportEdge',
              cursor: String(start + index + 1),
              node: summaryOf(report),
            })),
            pageInfo: {
              __typename: 'PageInfo',
              hasNextPage: start + pageSize < state.reports.length,
              endCursor: page.length ? String(start + page.length) : null,
            },
          },
        },
      })
    }),
    graphql.query('UnreadPlaybackReportCount', () =>
      HttpResponse.json({
        data: {
          unreadPlaybackReportCount: state.reports.filter((report) => !report.readAt).length,
        },
      }),
    ),
    graphql.query('PlaybackReport', ({ variables }) =>
      HttpResponse.json({
        data: {
          playbackReport: state.reports.find((report) => report.id === variables.id) ?? null,
        },
      }),
    ),
    graphql.mutation('MarkPlaybackReportRead', ({ variables }) => {
      const { playbackReportId } = (variables as MarkPlaybackReportReadMutationVariables).input
      state.marked.push(String(playbackReportId))
      const readAt = '2026-11-04T19:00:00Z'
      state.reports = state.reports.map((report) =>
        report.id === playbackReportId ? { ...report, readAt: report.readAt ?? readAt } : report,
      )
      return HttpResponse.json({
        data: {
          markPlaybackReportRead: {
            playbackReport: { __typename: 'PlaybackReport', id: playbackReportId, readAt },
            userErrors: [],
          },
        },
      })
    }),
  )
  return state
}

function sharedAtText(instant: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(instant),
  )
}

async function reportList(): Promise<HTMLElement> {
  return screen.findByRole('list', { name: 'Shared reports' })
}

// Each listed report as its link reads.
function listedReports(list: HTMLElement): string[] {
  return within(list)
    .getAllByRole('link')
    .map((link) => link.textContent)
}

function factsIn(container: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    within(container)
      .getAllByRole('term')
      .map((term) => [term.textContent, term.nextElementSibling?.textContent ?? '']),
  )
}

const OLDER = reportFixture({
  id: 'report-2',
  sharedAt: '2026-11-02T08:00:00Z',
  readAt: '2026-11-02T09:00:00Z',
  profileName: 'Sam',
  note: null,
})

describe('shared reports', () => {
  it('shouldListTheReportsNewestFirstWithTheUnreadCountWhenAServerAdminOpensSharedReports', async () => {
    serveReports({ reports: [reportFixture(), OLDER] })
    renderAppAt(REPORTS)

    const list = await reportList()

    expect(listedReports(list)).toEqual([
      `UnreadRobin${sharedAtText('2026-11-04T18:30:00Z')}Stutters after every seek`,
      `Sam${sharedAtText('2026-11-02T08:00:00Z')}No note`,
    ])
    expect(screen.getByRole('heading', { level: 1, name: 'Shared reports' })).toBeInTheDocument()
    expect(await screen.findByText('1 unread')).toBeInTheDocument()
    expect(
      within(screen.getByRole('navigation', { name: 'Server settings' })).getByRole('link', {
        name: 'Shared reports 1 unread',
      }),
    ).toBeInTheDocument()
  })

  it('shouldShowOlderReportsAfterTheLoadedOnesWhenTheServerAdminAsksForThem', async () => {
    const third = reportFixture({ id: 'report-3', profileName: 'Kai', readAt: OLDER.readAt })
    const state = serveReports({ reports: [reportFixture(), OLDER, third], pageSize: 2 })
    const { user } = renderAppAt(REPORTS)
    const list = await reportList()

    await user.click(screen.getByRole('button', { name: 'Show older reports' }))

    await waitFor(() => expect(within(list).getAllByRole('link')).toHaveLength(3))
    expect(within(list).getAllByRole('link')[2]).toHaveTextContent(/^Kai/)
    expect(state.pageReads.map((read) => read.after ?? null)).toEqual([null, '2'])
    expect(screen.queryByRole('button', { name: 'Show older reports' })).not.toBeInTheDocument()
  })

  it('shouldHoldOlderReportsBackWhileTheNewestReadAgainOnReturnToTheList', async () => {
    const reports = Array.from({ length: 5 }, (_, index) =>
      reportFixture({ id: `report-${index + 1}`, profileName: `Viewer ${index + 1}` }),
    )
    const state = serveReports({ reports, pageSize: 2 })
    const held = deferred()
    server.use(
      graphql.query('PlaybackReports', async ({ variables }) => {
        // The read of the newest reports on return to the list.
        if (!variables.after && state.pageReads.length === 2) {
          await held.promise
        }
        return undefined
      }),
    )
    const { user } = renderAppAt(REPORTS)
    await user.click(await screen.findByRole('button', { name: 'Show older reports' }))
    await waitFor(() =>
      expect(within(screen.getByRole('list')).getAllByRole('link')).toHaveLength(4),
    )
    await user.click(within(screen.getByRole('list')).getAllByRole('link')[0])
    await user.click(await screen.findByRole('link', { name: 'Back to shared reports' }))

    const showOlder = await screen.findByRole('button', { name: 'Show older reports' })

    expect(showOlder).toBeDisabled()
    await act(async () => {
      held.resolve()
      await held.promise
    })
    await waitFor(() => expect(showOlder).toBeEnabled())
    await user.click(showOlder)
    await waitFor(() =>
      expect(listedReports(screen.getByRole('list', { name: 'Shared reports' }))).toHaveLength(4),
    )
    expect(
      within(screen.getByRole('list', { name: 'Shared reports' }))
        .getAllByRole('link')
        .map((link) => /Viewer \d/.exec(link.textContent)?.[0]),
    ).toEqual(['Viewer 1', 'Viewer 2', 'Viewer 3', 'Viewer 4'])
  })

  it('shouldHoldOlderReportsBackWhileARetriedReadOfTheNewestIsOut', async () => {
    const reports = Array.from({ length: 5 }, (_, index) =>
      reportFixture({ id: `report-${index + 1}`, profileName: `Viewer ${index + 1}` }),
    )
    serveReports({ reports, pageSize: 2 })
    const held = deferred()
    let newestReads = 0
    server.use(
      graphql.query('PlaybackReports', async ({ variables }) => {
        if (variables.after) return undefined
        newestReads++
        // The read on return to the list fails, and its retry is held.
        if (newestReads === 2) return HttpResponse.json({ errors: [{ message: 'offline' }] })
        if (newestReads === 3) await held.promise
        return undefined
      }),
    )
    const { user } = renderAppAt(REPORTS)
    await user.click(await screen.findByRole('button', { name: 'Show older reports' }))
    await waitFor(() =>
      expect(within(screen.getByRole('list')).getAllByRole('link')).toHaveLength(4),
    )
    await user.click(within(screen.getByRole('list')).getAllByRole('link')[0])
    await user.click(await screen.findByRole('link', { name: 'Back to shared reports' }))

    await user.click(await screen.findByRole('button', { name: /retry/i }))

    expect(screen.getByRole('button', { name: 'Show older reports' })).toBeDisabled()
    await act(async () => {
      held.resolve()
      await held.promise
    })
  })

  it('shouldSayThatNoReportIsSharedWhenTheServerHoldsNone', async () => {
    serveReports({ reports: [] })
    renderAppAt(REPORTS)

    expect(
      await screen.findByText(
        "No shared reports. A viewer shares one from the player's Playback data panel.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Shared reports' })).not.toBeInTheDocument()
  })

  it('shouldShowTheSnapshotAndTheNoteAndMarkTheReportReadWhenTheServerAdminOpensIt', async () => {
    const state = serveReports({ reports: [reportFixture(), OLDER] })
    const { user } = renderAppAt(REPORTS)
    const list = await reportList()

    await user.click(within(list).getAllByRole('link')[0])

    const report = await screen.findByRole('article', { name: 'Report from Robin' })
    expect(within(report).getByRole('blockquote')).toHaveTextContent('Stutters after every seek')
    const server = within(report).getByRole('region', { name: 'Server' })
    expect(within(server).getByRole('region', { name: 'Video' })).toHaveTextContent('Copy')
    expect(factsIn(within(report).getByRole('region', { name: 'Player' }))).toEqual({
      'Quality step': '720p · 3 Mb/s (2 of 3)',
      'Observed bitrate': '12.5 Mb/s',
      Buffer: '8 s',
      'Dropped frames': '3',
      Stalls: '1',
      Resolution: '1280×720',
      'Video codec': 'avc1.64001f',
      'HDR mode': 'SDR',
      Audio: 'mp4a.40.2 stereo',
    })
    expect(factsIn(within(report).getByRole('region', { name: 'This screen' }))).toEqual({
      Screen: '2560×1440 at 2×',
      'HDR display': 'Yes',
      Browser: 'Chrome 141',
    })
    expect(
      within(within(report).getByRole('region', { name: 'Device capabilities' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'HEVC · Main 10 to level 5.1 · up to 3840×2160 at 60 fps, 10-bit · SDR, HDR10 · Dolby Vision 8.1 to level 6 · HLS · direct play from MP4 as hvc1',
      'AAC · up to 5.1 · HLS',
    ])
    await waitFor(() => expect(state.marked).toEqual(['report-1']))
    await waitFor(() =>
      expect(
        within(screen.getByRole('navigation', { name: 'Server settings' })).getByRole('link', {
          name: 'Shared reports',
        }),
      ).toBeInTheDocument(),
    )
  })

  it('shouldDropTheUnreadCountWhenAnOlderCountAnswersAfterTheReportIsMarkedRead', async () => {
    const state = serveReports({ reports: [reportFixture()] })
    const held = deferred()
    const countReads: number[] = []
    server.use(
      graphql.query('UnreadPlaybackReportCount', async () => {
        const unread = state.reports.filter((report) => !report.readAt).length
        countReads.push(unread)
        if (countReads.length === 1) {
          await held.promise
        }
        return HttpResponse.json({ data: { unreadPlaybackReportCount: unread } })
      }),
    )
    renderAppAt(`${REPORTS}/report-1`)
    const rail = await screen.findByRole('navigation', { name: 'Server settings' })

    await waitFor(() => expect(countReads).toEqual([1, 0]))
    await act(async () => {
      held.resolve()
      await held.promise
    })

    expect(state.marked).toEqual(['report-1'])
    await waitFor(() =>
      expect(within(rail).getByRole('link', { name: 'Shared reports' })).toBeInTheDocument(),
    )
  })

  it('shouldKeepAReportReadWhenAListReadFromBeforeTheMarkAnswersAfterIt', async () => {
    const state = serveReports({ reports: [reportFixture(), OLDER] })
    const before = state.reports.map(summaryOf)
    server.use(
      graphql.query('PlaybackReports', () =>
        HttpResponse.json({
          data: {
            playbackReports: {
              __typename: 'PlaybackReportConnection',
              edges: before.map((node, index) => ({
                __typename: 'PlaybackReportEdge',
                cursor: String(index + 1),
                node,
              })),
              pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: '2' },
            },
          },
        }),
      ),
    )
    const { user } = renderAppAt(`${REPORTS}/report-1`)
    await waitFor(() => expect(state.marked).toEqual(['report-1']))

    await user.click(await screen.findByRole('link', { name: 'Back to shared reports' }))

    const list = await reportList()
    expect(within(list).queryByText('Unread')).not.toBeInTheDocument()
  })

  it('shouldKeepAReportReadWhenARetriedReadFromBeforeTheMarkAnswersAfterIt', async () => {
    const state = serveReports({ reports: [reportFixture()] })
    const marks = deferred()
    const retried = deferred()
    let reportReads = 0
    server.use(
      graphql.mutation('MarkPlaybackReportRead', async () => {
        await marks.promise
        return undefined
      }),
      graphql.query('PlaybackReport', async () => {
        reportReads++
        // The read on return to the report fails, and its retry answers after the mark.
        if (reportReads === 2) return HttpResponse.json({ errors: [{ message: 'offline' }] })
        if (reportReads === 3) {
          const stale = state.reports[0]
          await retried.promise
          return HttpResponse.json({ data: { playbackReport: stale } })
        }
        return undefined
      }),
    )
    const { user } = renderAppAt(`${REPORTS}/report-1`)
    await screen.findByRole('article', { name: 'Report from Robin' })
    await user.click(screen.getByRole('link', { name: 'Back to shared reports' }))
    await user.click(within(await reportList()).getAllByRole('link')[0])
    await user.click(await screen.findByRole('button', { name: /retry/i }))

    await act(async () => {
      marks.resolve()
      await marks.promise
    })
    await waitFor(() => expect(state.marked).not.toHaveLength(0))
    await act(async () => {
      retried.resolve()
      await retried.promise
    })

    expect(await screen.findByText('First read')).toBeInTheDocument()
  })

  it('shouldReadTheUnreadCountAgainWhenTheNetworkReturns', async () => {
    const state = serveReports({ reports: [] })
    renderAppAt(REPORTS)
    await screen.findByText('0 unread')

    state.reports = [reportFixture()]
    window.dispatchEvent(new Event('online'))

    expect(await screen.findByText('1 unread')).toBeInTheDocument()
  })

  it('shouldReadTheUnreadCountAgainWhenTheLiveSocketReconnects', async () => {
    const state = serveReports({ reports: [] })
    const socket = serveGraphqlSocket()
    // A ServerAdmin who browses with a selected Profile, whose live changes run on the socket.
    server.use(
      graphql.query('Me', () =>
        HttpResponse.json({
          data: {
            me: meFixture({
              scope: 'profile',
              serverAdmin: true,
              profiles: [profileFixture({ selected: true })],
            }),
          },
        }),
      ),
    )
    renderAppAt(REPORTS)
    await screen.findByText('0 unread')
    await waitFor(() => expect(socket.isLive('LibraryStatusChanged')).toBe(true))

    state.reports = [reportFixture()]
    socket.closeAll(1001, 'Going away')

    expect(await screen.findByText('1 unread', undefined, { timeout: 3_000 })).toBeInTheDocument()
  })

  it('shouldOfferToMarkTheReportReadAgainWhenMarkingItFails', async () => {
    const state = serveReports({ reports: [reportFixture()] })
    let attempts = 0
    server.use(
      graphql.mutation('MarkPlaybackReportRead', () => {
        attempts++
        return attempts === 1 ? HttpResponse.error() : undefined
      }),
    )
    const { user } = renderAppAt(`${REPORTS}/report-1`)

    const failure = await screen.findByRole('alert')
    expect(failure).toHaveTextContent("Couldn't mark the report read.")
    await user.click(screen.getByRole('button', { name: /retry/i }))

    expect(await screen.findByText('First read')).toBeInTheDocument()
    expect(state.marked).toEqual(['report-1'])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shouldLeaveAReadReportAsItIsWhenTheServerAdminOpensIt', async () => {
    const state = serveReports({ reports: [OLDER] })
    renderAppAt(`${REPORTS}/report-2`)

    const report = await screen.findByRole('article', { name: 'Report from Sam' })

    expect(within(report).getByText('No note')).toBeInTheDocument()
    expect(state.marked).toEqual([])
  })

  it('shouldNameTheFormatAttemptWhoseFiguresThePlayerCapturedWhenTheReportHoldsSeveral', async () => {
    serveReports({
      reports: [
        reportFixture({
          streamSessionId: 'sess-2',
          requestedChoice: 'ORIGINAL',
          playbackChoice: 'ORIGINAL',
          decisions: [
            servedDecision(
              playbackDecision({
                streamSessionId: 'sess-1',
                video: { delivery: 'COPY', source: HEVC_UHD, output: HEVC_UHD },
              }),
            ),
            servedDecision(
              playbackDecision({
                formatAttempt: 2,
                streamSessionId: 'sess-2',
                video: { delivery: 'ENCODE', source: HEVC_UHD, output: H264_FULL_HD },
                reasons: ['COPY_FAILED'],
              }),
            ),
          ],
        }),
      ],
    })
    renderAppAt(`${REPORTS}/report-1`)

    const report = await screen.findByRole('article', { name: 'Report from Robin' })
    const server = within(report).getByRole('region', { name: 'Server' })

    expect(
      within(server)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Format attempt 1', 'Format attempt 2 · the player’s figures'])
    expect(within(report).getByText('Playback choice: Original, played as Original')).toBeVisible()
  })

  it('shouldShowTheTvsDisplayAndAudioOutputWhenATvClientSharedTheReport', async () => {
    const { player } = reportFixture()
    serveReports({
      reports: [
        reportFixture({
          player: {
            ...player,
            hdrMode: 'DOLBY_VISION',
            audio: { __typename: 'PlayerAudio', codec: 'ec-3', channels: 6, dolbyAtmos: true },
            screen: null,
            browser: null,
            display: {
              __typename: 'PlayerDisplay',
              width: 3840,
              height: 2160,
              hdrMode: 'HDR10',
              refreshRate: 23.976,
              dynamicRangeMatched: false,
              frameRateMatched: true,
            },
            audioOutput: { __typename: 'PlayerAudioOutput', route: 'HDMI', channels: 8 },
          },
        }),
      ],
    })
    renderAppAt(`${REPORTS}/report-1`)

    const report = await screen.findByRole('article', { name: 'Report from Robin' })

    expect(factsIn(within(report).getByRole('region', { name: 'Player' }))).toMatchObject({
      'HDR mode': 'Dolby Vision',
      Audio: 'ec-3 5.1 Atmos',
    })
    expect(factsIn(within(report).getByRole('region', { name: 'This TV' }))).toEqual({
      Display: '3840×2160 HDR10 · 23.976 Hz (frame rate matched, dynamic range not matched)',
      'Audio output': 'HDMI · 8 channels',
    })
    expect(within(report).queryByRole('region', { name: 'This screen' })).not.toBeInTheDocument()
  })

  it('shouldSayTheReportIsGoneWhenTheServerHoldsNoReportWithTheId', async () => {
    serveReports({ reports: [] })
    renderAppAt(`${REPORTS}/report-9`)

    expect(
      await screen.findByText(
        'This report no longer exists. The server deletes a report 30 days after it was shared.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to shared reports' })).toBeInTheDocument()
  })

  it('shouldOfferAnotherTryWhenTheReportsCannotLoad', async () => {
    serveReports({ reports: [reportFixture()] })
    let failing = true
    server.use(
      graphql.query('PlaybackReports', () =>
        failing ? HttpResponse.json({ errors: [{ message: 'offline' }] }) : undefined,
      ),
    )
    const { user } = renderAppAt(REPORTS)

    const retry = await screen.findByRole('button', { name: /retry/i })
    failing = false
    await user.click(retry)

    expect(listedReports(await reportList())).toHaveLength(1)
  })
})
