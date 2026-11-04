import { screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { ActiveStreamFieldsFragment } from '../../graphql/generated/graphql'
import { deferred } from '../../test/deferred'
import { serveGraphqlSocket } from '../../test/graphqlSocket'
import { meFixture } from '../../test/meFixture'
import { H264_FULL_HD, playbackDecision, servedDecision } from '../../test/playbackSession'
import { renderAppAt } from '../../test/render'
import { server } from '../../test/server'

const ADMIN = meFixture({ scope: 'profile', serverAdmin: true })
const PAGE = '/settings/server/streams'
const CHANGED = 'ActiveStreamsChanged'

const HEVC_UHD = {
  ...H264_FULL_HD,
  codec: 'hevc',
  width: 3840,
  height: 2160,
  videoRange: 'PQ',
} as const

// A movie that plays from an encode at 1080p, because the browser plays neither HEVC nor HDR and the
// viewer chose a lower quality, after a copy of it failed.
const MOVIE: ActiveStreamFieldsFragment = {
  playbackSessionId: 'playback-movie',
  profile: { id: 'profile-ada', name: 'Ada' },
  deviceName: 'Safari on Mac',
  mediaFileId: 'file-movie',
  title: 'Everlight',
  seriesTitle: null,
  seasonNumber: null,
  episodeNumber: null,
  positionSeconds: 754,
  state: 'PLAYING',
  decision: playbackDecision({
    streamSessionId: 'sess-movie',
    video: { delivery: 'ENCODE', source: HEVC_UHD, output: H264_FULL_HD },
    reasons: [
      'COPY_FAILED',
      'VIDEO_CODEC_NOT_DECLARED',
      'DYNAMIC_RANGE_NOT_DECLARED',
      'PICTURE_ABOVE_VIEWER_LIMIT',
    ],
  }),
  workers: ['worker-session-1'],
}

// An episode that plays from a copy, paused.
const EPISODE: ActiveStreamFieldsFragment = {
  ...MOVIE,
  playbackSessionId: 'playback-episode',
  profile: { id: 'profile-ben', name: 'Ben' },
  deviceName: 'Apple TV',
  mediaFileId: 'file-episode',
  title: 'Breakage',
  seriesTitle: 'Northern Line',
  seasonNumber: 2,
  episodeNumber: 5,
  positionSeconds: 3_725,
  state: 'PAUSED',
  decision: playbackDecision({ streamSessionId: 'sess-episode' }),
  workers: ['worker-session-1', 'worker-session-2'],
}

// The stream as the server sends it, with the __typename of every object Apollo selects.
function served(stream: ActiveStreamFieldsFragment) {
  return {
    __typename: 'ActiveStream',
    ...stream,
    profile: { __typename: 'ActiveStreamProfile', ...stream.profile },
    decision: stream.decision && servedDecision(stream.decision),
  }
}

/**
 * Serves the Me query, the live socket and the list as `listed` holds it at each read. A read
 * waits for `held` when set, then answers with the list as it is at that moment.
 */
function serve(streams: ActiveStreamFieldsFragment[] = [MOVIE, EPISODE]) {
  const state = {
    listed: streams,
    reads: 0,
    held: null as Promise<void> | null,
    socket: serveGraphqlSocket(),
  }
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: ADMIN } })),
    graphql.query('ActiveStreams', async () => {
      state.reads++
      const listed = state.listed
      if (state.held) await state.held
      return HttpResponse.json({ data: { activeStreams: listed.map(served) } })
    }),
  )
  return state
}

function publishChange(
  state: ReturnType<typeof serve>,
  playbackSessionId: string,
  activeStream: ActiveStreamFieldsFragment | null,
) {
  state.socket.publish(CHANGED, {
    data: {
      activeStreamsChanged: {
        __typename: 'ActiveStreamChange',
        playbackSessionId,
        activeStream: activeStream && served(activeStream),
      },
    },
  })
}

async function streamRow(name: string): Promise<HTMLElement> {
  return screen.findByRole('article', { name })
}

function factsIn(row: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    within(row)
      .getAllByRole('term')
      .map((term) => [term.textContent, term.nextElementSibling?.textContent ?? '']),
  )
}

function reasonsIn(row: HTMLElement, list: string): string[] {
  return within(within(row).getByRole('list', { name: list }))
    .getAllByRole('listitem')
    .map((reason) => reason.textContent ?? '')
}

// A track of the stream's decision: its heading, and each table row as its cells read.
function trackIn(row: HTMLElement, name: string) {
  const track = within(row).getByRole('region', { name })
  return {
    heading: within(track).getByRole('heading').textContent,
    rows: within(within(track).getByRole('table'))
      .getAllByRole('row')
      .map((tableRow) => Array.from(tableRow.children, (cell) => cell.textContent)),
  }
}

function rowNames(): string[] {
  return screen.queryAllByRole('article').map((row) => row.getAttribute('aria-label') ?? '')
}

async function liveChanges(state: ReturnType<typeof serve>) {
  await waitFor(() => expect(state.socket.isLive(CHANGED)).toBe(true))
}

describe('active streams', () => {
  it('shouldListEachActiveStreamWithWhoWatchesWhatPlaysAndHowWhenAServerAdminOpensThePage', async () => {
    serve()
    renderAppAt(PAGE)

    const movie = await streamRow('Everlight')
    const episode = await streamRow('Northern Line · S2 E5 · Breakage')

    expect(factsIn(movie)).toEqual({
      Viewer: 'Ada',
      Device: 'Safari on Mac',
      Position: '12:34 · Playing',
      'Output bitrate': '8.2 Mb/s',
      Workers: 'worker-session-1',
    })
    expect(trackIn(movie, 'Video')).toEqual({
      heading: 'Video Encode',
      rows: [
        ['Property', 'Original', 'Playing'],
        ['Codec (changed)', 'HEVC', 'H.264'],
        ['HDR (changed)', 'HDR10', 'SDR'],
        ['Resolution (changed)', '3840×2160', '1920×1080'],
        ['Frame rate', '23.976', '23.976'],
        ['Bitrate', '8 Mb/s', '8 Mb/s'],
      ],
    })
    expect(trackIn(movie, 'Audio')).toEqual({
      heading: 'Audio Copy',
      rows: [
        ['Property', 'Original', 'Playing'],
        ['Codec', 'AAC', 'AAC'],
        ['Channels', '2', '2'],
        ['Bitrate', '192 kb/s', '192 kb/s'],
      ],
    })
    expect(reasonsIn(movie, 'Stream reasons')).toEqual([
      'The copy failed, so the server encodes the video instead.',
    ])
    expect(reasonsIn(movie, 'Video reasons')).toEqual([
      "This device can't play the video's codec (HEVC).",
      "This device can't show HDR10, so the server converts it.",
      'The viewer chose a lower quality, so the server scales this 3840×2160 video down to 1080p.',
    ])
    expect(factsIn(episode)).toEqual({
      Viewer: 'Ben',
      Device: 'Apple TV',
      Position: '1:02:05 · Paused',
      'Output bitrate': '8.2 Mb/s',
      Workers: 'worker-session-1, worker-session-2',
    })
    expect(trackIn(episode, 'Video').heading).toBe('Video Copy')
  })

  it('shouldNameWhatTheServerCannotWhenAStreamPreparesForAnUnmatchedFileOfADeletedProfile', async () => {
    serve([
      {
        ...MOVIE,
        profile: { id: 'profile-gone', name: null },
        deviceName: null,
        title: null,
        positionSeconds: null,
        state: null,
        decision: null,
        workers: [],
      },
    ])
    renderAppAt(PAGE)

    const row = await streamRow('A file without a matched title')

    expect(factsIn(row)).toEqual({
      Viewer: 'A deleted Profile',
      Device: 'Not named',
      Position: 'Preparing',
      'Output bitrate': 'Not known',
      Workers: 'None',
    })
  })

  it('shouldSayNothingPlaysWhenNoStreamIsActive', async () => {
    serve([])
    renderAppAt(PAGE)

    expect(await screen.findByText('Nothing is playing right now.')).toBeInTheDocument()
  })

  it('shouldAddAStreamThatStartsWhileThePageShows', async () => {
    const state = serve([MOVIE])
    renderAppAt(PAGE)
    await streamRow('Everlight')
    await liveChanges(state)

    publishChange(state, EPISODE.playbackSessionId, EPISODE)

    await streamRow('Northern Line · S2 E5 · Breakage')
    expect(rowNames()).toEqual(['Everlight', 'Northern Line · S2 E5 · Breakage'])
  })

  it('shouldShowAStreamsNewPositionAndStateWhenItChanges', async () => {
    const state = serve([MOVIE])
    renderAppAt(PAGE)
    await streamRow('Everlight')
    await liveChanges(state)

    publishChange(state, MOVIE.playbackSessionId, {
      ...MOVIE,
      positionSeconds: 800,
      state: 'PAUSED',
    })

    await waitFor(async () =>
      expect(factsIn(await streamRow('Everlight')).Position).toBe('13:20 · Paused'),
    )
  })

  it('shouldDropAStreamThatEndsAndSayNothingPlaysOnceTheLastEnds', async () => {
    const state = serve([MOVIE, EPISODE])
    renderAppAt(PAGE)
    await streamRow('Everlight')
    await liveChanges(state)

    publishChange(state, MOVIE.playbackSessionId, null)
    await waitFor(() => expect(rowNames()).toEqual(['Northern Line · S2 E5 · Breakage']))
    publishChange(state, EPISODE.playbackSessionId, null)

    expect(await screen.findByText('Nothing is playing right now.')).toBeInTheDocument()
  })

  it('shouldKeepAChangeThatArrivesWhileTheListIsReadWhenTheReadAnswersWithTheStateBeforeIt', async () => {
    const state = serve([MOVIE, EPISODE])
    const read = deferred()
    state.held = read.promise
    renderAppAt(PAGE)
    await liveChanges(state)
    await waitFor(() => expect(state.reads).toBeGreaterThan(0))

    publishChange(state, MOVIE.playbackSessionId, null)
    publishChange(state, EPISODE.playbackSessionId, { ...EPISODE, state: 'PLAYING' })
    read.resolve()

    const episode = await streamRow('Northern Line · S2 E5 · Breakage')
    expect(factsIn(episode).Position).toBe('1:02:05 · Playing')
    expect(rowNames()).toEqual(['Northern Line · S2 E5 · Breakage'])
  })

  it('shouldReadTheListAgainWhenTheSocketSubscribesAgainAfterAGap', async () => {
    const state = serve([MOVIE])
    renderAppAt(PAGE)
    await streamRow('Everlight')
    await liveChanges(state)
    const readsBefore = state.reads

    state.listed = [EPISODE]
    state.socket.closeAll(1001, 'Going away')

    await streamRow('Northern Line · S2 E5 · Breakage')
    expect(rowNames()).toEqual(['Northern Line · S2 E5 · Breakage'])
    expect(state.reads).toBeGreaterThan(readsBefore)
  })

  it('shouldKeepTheRowAndReadAgainWhenAChangeArrivesWithoutItsStream', async () => {
    const state = serve([MOVIE])
    renderAppAt(PAGE)
    await streamRow('Everlight')
    await liveChanges(state)
    const readsBefore = state.reads
    const reread = deferred()
    state.held = reread.promise
    state.listed = [{ ...MOVIE, state: 'PAUSED' }]

    state.socket.publish(CHANGED, {
      data: {
        activeStreamsChanged: {
          __typename: 'ActiveStreamChange',
          playbackSessionId: MOVIE.playbackSessionId,
          activeStream: null,
        },
      },
      errors: [{ message: 'Internal failure', path: ['activeStreamsChanged', 'activeStream'] }],
    })
    await waitFor(() => expect(state.reads).toBeGreaterThan(readsBefore))

    expect(factsIn(await streamRow('Everlight')).Position).toBe('12:34 · Playing')
    reread.resolve()
    await waitFor(async () =>
      expect(factsIn(await streamRow('Everlight')).Position).toBe('12:34 · Paused'),
    )
  })

  it.each([
    {
      stop: 'a refusal',
      errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }],
      shown: 'You no longer have permission to see active streams.',
    },
    {
      stop: 'a failure',
      errors: [{ message: 'Internal failure' }],
      shown: 'Live updates stopped. Reload the page to see the latest streams.',
    },
  ])(
    'shouldSayLiveUpdatesStoppedWhenTheSubscriptionEndsWith(stop: $stop)',
    async ({ errors, shown }) => {
      const state = serve([MOVIE])
      renderAppAt(PAGE)
      await streamRow('Everlight')
      await liveChanges(state)

      state.socket.publish(CHANGED, { errors })
      state.socket.complete(CHANGED)

      expect(await screen.findByRole('alert')).toHaveTextContent(shown)
      expect(await streamRow('Everlight')).toBeInTheDocument()
    },
  )

  it('shouldReadTheListAgainWhenTheAdminRetriesAFailedRead', async () => {
    const state = serve([MOVIE])
    let failing = true
    server.use(
      graphql.query('ActiveStreams', () => {
        state.reads++
        if (failing) return HttpResponse.json({ errors: [{ message: 'Internal failure' }] })
        return HttpResponse.json({ data: { activeStreams: state.listed.map(served) } })
      }),
    )
    const { user } = renderAppAt(PAGE)
    const retry = await screen.findByRole('button', { name: 'Retry' })

    failing = false
    await user.click(retry)

    expect(await streamRow('Everlight')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('shouldSayActiveStreamsNeedAServerAdminWhenTheServerRefusesTheList', async () => {
    serve()
    server.use(
      graphql.query('ActiveStreams', () =>
        HttpResponse.json({
          data: null,
          errors: [
            { message: 'Forbidden', path: ['activeStreams'], extensions: { code: 'FORBIDDEN' } },
          ],
        }),
      ),
    )
    renderAppAt(PAGE)

    expect(
      await screen.findByText(
        'Active streams are available to server admins using an account session.',
      ),
    ).toBeInTheDocument()
  })

  it('shouldOfferActiveStreamsInTheServerSettingsRail', async () => {
    serve()
    server.use(
      graphql.query('EncoderPresetSetting', () =>
        HttpResponse.json({ errors: [{ message: 'Internal failure' }] }),
      ),
    )
    const { user } = renderAppAt('/settings/server/encoding')
    const rail = await screen.findByRole('navigation', { name: 'Server settings' })

    await user.click(within(rail).getByRole('link', { name: 'Active streams' }))

    expect(await streamRow('Everlight')).toBeInTheDocument()
    expect(within(rail).getByRole('link', { name: 'Active streams' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
