import { act, screen, waitFor, within } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ActiveStreamFieldsFragment,
  ActiveStreamPosterFieldsFragment,
  PlaybackDelivery,
  PlaybackState,
} from '../../graphql/generated/graphql'
import { deferred } from '../../test/deferred'
import { serveGraphqlSocket } from '../../test/graphqlSocket'
import { comeBackOnline } from '../../test/graphqlResponses'
import { meFixture } from '../../test/meFixture'
import {
  AAC_STEREO,
  H264_FULL_HD,
  playbackDecision,
  servedDecision,
} from '../../test/playbackSession'
import { renderAppAt } from '../../test/render'
import type { UserEvent } from '@testing-library/user-event'
import { server } from '../../test/server'
import { videoFormatDetails } from '../../test/videoFormatDetails'

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
  media: {
    __typename: 'Movie',
    id: 'movie-everlight',
    title: 'Everlight',
    runtime: 118,
    images: [],
  },
  positionSeconds: 754,
  producedRange: { startSeconds: 600, endSeconds: 1_500.5 },
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

type EpisodeMedia = Extract<ActiveStreamFieldsFragment['media'], { __typename: 'Episode' }>

const BREAKAGE: EpisodeMedia = {
  __typename: 'Episode',
  id: 'episode-breakage',
  title: 'Breakage',
  episodeNumber: 5,
  runtime: 52,
  season: {
    id: 'season-northern-line-2',
    seasonNumber: 2,
    series: { id: 'series-northern-line', title: 'Northern Line', images: [] },
  },
}

// An episode that plays from a copy, paused.
const EPISODE: ActiveStreamFieldsFragment = {
  ...MOVIE,
  playbackSessionId: 'playback-episode',
  profile: { id: 'profile-ben', name: 'Ben' },
  deviceName: 'Apple TV',
  mediaFileId: 'file-episode',
  media: BREAKAGE,
  positionSeconds: 3_725,
  producedRange: { startSeconds: 3_600, endSeconds: 3_900 },
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
    media: servedMedia(stream.media),
    decision: stream.decision && servedDecision(stream.decision),
  }
}

// Fragment spreads on Image only match in the cache when each image carries its __typename.
function servedMedia(media: ActiveStreamFieldsFragment['media']) {
  if (!media) return media
  if (media.__typename === 'Movie') return { ...media, images: servedImages(media.images) }
  const { season } = media
  return {
    ...media,
    season: {
      __typename: 'Season',
      ...season,
      series: {
        __typename: 'Series',
        ...season.series,
        images: servedImages(season.series.images),
      },
    },
  }
}

function servedImages(images: readonly (ActiveStreamPosterFieldsFragment | null)[]) {
  return images.map((image) => image && { __typename: 'Image', ...image })
}

/**
 * Serves the Me query, the live socket and the list as `listed` holds it when each read arrives.
 * Every read waits for `held` when set, and the next read alone for `heldOnce`; while `failing`,
 * each read fails.
 */
function serve(streams: ActiveStreamFieldsFragment[] = [MOVIE, EPISODE]) {
  const state = {
    listed: streams,
    reads: 0,
    held: null as Promise<void> | null,
    heldOnce: null as Promise<void> | null,
    failing: false,
    socket: serveGraphqlSocket(),
  }
  server.use(
    graphql.query('Me', () => HttpResponse.json({ data: { me: ADMIN } })),
    // A socket that subscribes again reads every active query again, the top bar's among them.
    graphql.query('Libraries', () => HttpResponse.json({ data: { libraries: [] } })),
    graphql.query('ActiveStreams', async () => {
      state.reads++
      if (state.failing) return HttpResponse.json({ errors: [{ message: 'Internal failure' }] })
      const listed = state.listed
      const heldOnce = state.heldOnce
      state.heldOnce = null
      await Promise.all([state.held, heldOnce])
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

const MOVIE_CARD = 'Everlight, Ada. Playing, Encode.'
const EPISODE_CARD = 'Northern Line, S2 E5 · Breakage, Ben. Paused, Copy.'
const ZOE_MOVIE_CARD = 'Everlight, Zoe. Playing, Encode.'

async function streamCard(name: string): Promise<HTMLElement> {
  return screen.findByRole('button', { name })
}

// The cards in the order they show; the details' close button is the grid's other button.
function cardNames(): string[] {
  const grid = screen.queryByTestId('stream-grid')
  if (!grid) return []
  return within(grid)
    .getAllByRole('button')
    .filter((button) => button.hasAttribute('aria-expanded'))
    .map((card) => card.getAttribute('aria-label') ?? '')
}

async function openDetails(user: UserEvent, card: string, title: string): Promise<HTMLElement> {
  await user.click(await streamCard(card))
  return screen.findByRole('region', { name: title })
}

function factsIn(details: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    within(details)
      .getAllByRole('term')
      .map((term) => [term.textContent, term.nextElementSibling?.textContent ?? '']),
  )
}

function reasonsIn(details: HTMLElement, list: string): string[] {
  return within(within(details).getByRole('list', { name: list }))
    .getAllByRole('listitem')
    .map((reason) => reason.textContent ?? '')
}

// A track of the stream's decision: its heading, and each table row as its cells read.
function trackIn(details: HTMLElement, name: string) {
  const track = within(details).getByRole('region', { name })
  return {
    heading: within(track).getByRole('heading').textContent,
    rows: within(within(track).getByRole('table'))
      .getAllByRole('row')
      .map((tableRow) => Array.from(tableRow.children, (cell) => cell.textContent)),
  }
}

async function liveChanges(state: ReturnType<typeof serve>) {
  await waitFor(() => expect(state.socket.isLive(CHANGED)).toBe(true))
}

// How long the page waits for a read of the list before it gives the read up.
const ACTIVE_STREAMS_READ_DEADLINE_MS = 15_000

// How long a test waits for a closed socket to reconnect. The socket waits up to a second first.
const SOCKET_RECONNECT_DEADLINE_MS = 3_000

describe('active streams', () => {
  it('should show the source and delivered video facts in the admin stream details', async () => {
    const decision = playbackDecision({
      streamSessionId: 'sess-movie',
      video: {
        delivery: 'ENCODE',
        source: {
          ...HEVC_UHD,
          details: videoFormatDetails({ bitDepth: 10, compatibleBase: 'PQ', hdr10Plus: 'PRESENT' }),
        },
        output: {
          ...H264_FULL_HD,
          details: videoFormatDetails({ bitDepth: 8, compatibleBase: 'SDR', hdr10Plus: 'ABSENT' }),
        },
      },
    })
    serve([{ ...MOVIE, decision }])
    const { user } = renderAppAt(PAGE)

    const details = await openDetails(user, MOVIE_CARD, 'Everlight')

    expect(trackIn(details, 'Video').rows).toContainEqual([
      'Bit depth (changed)',
      '10-bit',
      '8-bit',
    ])
    expect(trackIn(details, 'Video').rows).toContainEqual(['HDR (changed)', 'HDR10+', 'SDR'])
    expect(trackIn(details, 'Video').rows).toContainEqual([
      'HDR base (changed)',
      'PQ (ST 2084)',
      'SDR',
    ])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shouldShowEachActiveStreamAsAPosterWithWhoWatchesWhenAServerAdminOpensThePage', async () => {
    serve()
    renderAppAt(PAGE)

    await streamCard(MOVIE_CARD)

    expect(cardNames()).toEqual([MOVIE_CARD, EPISODE_CARD])
    const episode = await streamCard(EPISODE_CARD)
    expect(within(episode).getByText('BE')).toBeInTheDocument()
    expect(within(episode).getByText('Ben')).toBeInTheDocument()
    expect(within(episode).getByText('S2 E5 · Breakage')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Active streams2')
    expect(screen.getByText('Output up to 16.4 Mb/s · 1 copy, 1 encode')).toBeInTheDocument()
  })

  it('shouldShowTheSeriesPosterOnAnEpisodesCard', async () => {
    const poster: ActiveStreamPosterFieldsFragment = {
      aspectRatio: 0.67,
      blurHash: null,
      variants: [
        { id: 'poster-medium', size: 'MEDIUM', width: 342, height: 513, url: 'poster.jpg' },
      ],
    }
    const series = { ...BREAKAGE.season.series, images: [poster] }
    serve([{ ...EPISODE, media: { ...BREAKAGE, season: { ...BREAKAGE.season, series } } }])
    renderAppAt(PAGE)

    const card = await streamCard(EPISODE_CARD)

    expect(within(card).getByRole('img', { name: 'Northern Line' })).toHaveAttribute(
      'src',
      'poster.jpg',
    )
  })

  it('shouldShowWhereThePlayerIsAndTheProducedStretchOnTheCardsTrack', async () => {
    serve([MOVIE])
    renderAppAt(PAGE)
    const runtime = 118 * 60

    const track = within(await streamCard(MOVIE_CARD)).getByRole('progressbar', {
      name: 'Position',
    })

    expect(track).toHaveAttribute('aria-valuenow', String(Math.round((754 / runtime) * 100)))
    expect(within(track).getByTestId('produced-range')).toHaveStyle({
      left: `${(600 / runtime) * 100}%`,
      width: `${((1_500.5 - 600) / runtime) * 100}%`,
    })
  })

  it('shouldLeaveOutTheProducedStretchWhenTheServerReportsNoneForADirectPlay', async () => {
    const directPlay = playbackDecision({
      streamSessionId: 'sess-direct',
      video: { delivery: 'DIRECT_PLAY', source: H264_FULL_HD, output: H264_FULL_HD },
      audio: null,
    })
    serve([{ ...MOVIE, decision: directPlay, producedRange: null }])
    const { user } = renderAppAt(PAGE)
    const card = 'Everlight, Ada. Playing, Direct play.'

    const details = await openDetails(user, card, 'Everlight')

    const track = within(await streamCard(card)).getByRole('progressbar', { name: 'Position' })
    expect(within(track).queryByTestId('produced-range')).not.toBeInTheDocument()
    expect(factsIn(details)).not.toHaveProperty('Produced')
  })

  it('shouldMoveTheProducedStretchWhenAChangeReportsANewOne', async () => {
    const state = serve([MOVIE])
    const { user } = renderAppAt(PAGE)
    const details = await openDetails(user, MOVIE_CARD, 'Everlight')
    await liveChanges(state)

    publishChange(state, MOVIE.playbackSessionId, {
      ...MOVIE,
      producedRange: { startSeconds: 600, endSeconds: 1_800 },
    })

    await waitFor(() => expect(factsIn(details).Produced).toBe('10:00 to 30:00'))
  })

  it('shouldShowWhoWatchesWhatPlaysAndHowWhenTheAdminOpensAStreamsDetails', async () => {
    serve()
    const { user } = renderAppAt(PAGE)

    const movie = await openDetails(user, MOVIE_CARD, 'Everlight')

    expect(await streamCard(MOVIE_CARD)).toHaveAttribute('aria-expanded', 'true')
    expect(factsIn(movie)).toEqual({
      Viewer: 'Ada',
      Device: 'Safari on Mac',
      Position: '12:34 · Playing',
      Produced: '10:00 to 25:00',
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

    const episode = await openDetails(user, EPISODE_CARD, 'Northern Line')

    expect(screen.queryByRole('region', { name: 'Everlight' })).not.toBeInTheDocument()
    expect(within(episode).getByText('S2 E5 · Breakage')).toBeInTheDocument()
    expect(factsIn(episode)).toEqual({
      Viewer: 'Ben',
      Device: 'Apple TV',
      Position: '1:02:05 · Paused',
      Produced: '1:00:00 to 1:05:00',
      'Output bitrate': '8.2 Mb/s',
      Workers: 'worker-session-1, worker-session-2',
    })
    expect(trackIn(episode, 'Video').heading).toBe('Video Copy')
  })

  it.each([
    { close: 'presses Escape', act: (user: UserEvent) => user.keyboard('{Escape}') },
    {
      close: 'presses Close details',
      act: (user: UserEvent) => user.click(screen.getByRole('button', { name: 'Close details' })),
    },
  ])(
    'shouldCloseTheDetailsAndReturnToTheCardWhenTheAdmin(close: $close)',
    async ({ act: close }) => {
      serve()
      const { user } = renderAppAt(PAGE)
      const details = await openDetails(user, MOVIE_CARD, 'Everlight')
      within(details).getByRole('button', { name: 'Close details' }).focus()

      await close(user)

      expect(screen.queryByRole('region', { name: 'Everlight' })).not.toBeInTheDocument()
      expect(await streamCard(MOVIE_CARD)).toHaveFocus()
      expect(await streamCard(MOVIE_CARD)).toHaveAttribute('aria-expanded', 'false')
    },
  )

  it('shouldSayAStreamStoppedWhenTheClientLastReportedItStopped', async () => {
    serve([{ ...MOVIE, state: 'STOPPED' }])
    const { user } = renderAppAt(PAGE)

    const details = await openDetails(user, 'Everlight, Ada. Stopped, Encode.', 'Everlight')

    expect(factsIn(details).Position).toBe('12:34 · Stopped')
  })

  it('shouldLeaveOutAStateNewerThanThePageKnows', async () => {
    serve([{ ...MOVIE, state: 'BUFFERING' as PlaybackState }])
    const { user } = renderAppAt(PAGE)

    const details = await openDetails(user, 'Everlight, Ada. Encode.', 'Everlight')

    expect(factsIn(details).Position).toBe('12:34')
  })

  it('shouldCloseTheDetailsWhenTheAdminPressesTheOpenCardAgain', async () => {
    serve()
    const { user } = renderAppAt(PAGE)
    await openDetails(user, MOVIE_CARD, 'Everlight')

    await user.click(await streamCard(MOVIE_CARD))

    expect(screen.queryByRole('region', { name: 'Everlight' })).not.toBeInTheDocument()
  })

  it('shouldSayWhatTheServerCannotWhenAStreamPreparesForAnUnmatchedFileOfADeletedProfile', async () => {
    serve([
      {
        ...MOVIE,
        profile: { id: 'profile-gone', name: null },
        deviceName: null,
        media: null,
        positionSeconds: null,
        producedRange: null,
        state: null,
        decision: null,
        workers: [],
      },
    ])
    const { user } = renderAppAt(PAGE)

    const details = await openDetails(
      user,
      'A file without a matched title, A deleted Profile. Preparing.',
      'A file without a matched title',
    )

    expect(factsIn(details)).toEqual({
      Viewer: 'A deleted Profile',
      Device: 'Not named',
      Position: 'Preparing',
      'Output bitrate': 'Not known',
      Workers: 'None',
    })
    expect(
      within(details).getByText('The tracks appear once the stream starts.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Active streams1')
    expect(screen.queryByText(/Mb\/s|kb\/s/)).not.toBeInTheDocument()
  })

  it('shouldShowOnlyTheStreamsOfADeliveryWhenTheAdminPicksItsChip', async () => {
    serve()
    const { user } = renderAppAt(PAGE)
    await streamCard(MOVIE_CARD)
    const chips = () =>
      screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-pressed'))

    expect(chips().map((chip) => chip.textContent)).toEqual(['All 2', 'Copy', 'Encode'])

    await user.click(screen.getByRole('button', { name: 'Encode' }))

    expect(screen.getByRole('button', { name: 'Encode' })).toHaveAttribute('aria-pressed', 'true')
    expect(cardNames()).toEqual([MOVIE_CARD])

    await user.click(screen.getByRole('button', { name: 'All 2' }))

    expect(cardNames()).toEqual([MOVIE_CARD, EPISODE_CARD])
  })

  it('shouldShowOnlyTheStreamsAWorkerServesWhenTheAdminPicksTheWorker', async () => {
    serve()
    const { user } = renderAppAt(PAGE)
    await streamCard(MOVIE_CARD)

    await user.click(screen.getByRole('button', { name: 'Any worker' }))
    await user.click(
      within(screen.getByRole('menu', { name: 'Worker' })).getByRole('menuitemradio', {
        name: 'worker-session-2',
      }),
    )

    expect(cardNames()).toEqual([EPISODE_CARD])
    expect(screen.queryByRole('menu', { name: 'Worker' })).not.toBeInTheDocument()
  })

  it.each([
    { dismiss: 'presses Escape', act: (user: UserEvent) => user.keyboard('{Escape}') },
    {
      dismiss: 'clicks outside it',
      act: (user: UserEvent) => user.click(screen.getByRole('heading', { level: 1 })),
    },
  ])('shouldCloseAMenuWithoutAChoiceWhenTheAdmin(dismiss: $dismiss)', async ({ act: dismiss }) => {
    serve()
    const { user } = renderAppAt(PAGE)
    await streamCard(MOVIE_CARD)
    await user.click(screen.getByRole('button', { name: 'Sort: Viewer' }))
    expect(screen.getByRole('menu', { name: 'Sort' })).toBeInTheDocument()

    await dismiss(user)

    expect(screen.queryByRole('menu', { name: 'Sort' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sort: Viewer' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('shouldMoveThroughAMenuByKeyboardAndReturnToItsButtonWhenTheAdminChoosesOrLeaves', async () => {
    serve()
    const { user } = renderAppAt(PAGE)
    await streamCard(MOVIE_CARD)

    await user.click(screen.getByRole('button', { name: 'Sort: Viewer' }))
    expect(screen.getByRole('menuitemradio', { name: 'Viewer' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemradio', { name: 'Title' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitemradio', { name: 'Output bitrate' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('button', { name: 'Sort: Output bitrate' })).toHaveFocus()

    await user.keyboard('{Enter}')
    await user.keyboard('{Escape}')

    expect(screen.getByRole('button', { name: 'Sort: Output bitrate' })).toHaveFocus()
  })

  it('shouldCloseAMenuWhenFocusLeavesItSoEscapeLaterKeepsFocusWhereItIs', async () => {
    serve()
    const { user } = renderAppAt(PAGE)
    await streamCard(MOVIE_CARD)
    await user.click(screen.getByRole('button', { name: 'Any worker' }))
    const search = screen.getByRole('searchbox', { name: 'Search viewers, titles and devices' })

    await user.tab()

    expect(screen.queryByRole('menu', { name: 'Worker' })).not.toBeInTheDocument()
    expect(search).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(search).toHaveFocus()
  })

  it('shouldLeaveTheOutputTotalOutWhenAStreamsOutputBitrateIsNotKnown', async () => {
    const unknownOutput = playbackDecision({
      streamSessionId: 'sess-unknown',
      video: { delivery: 'COPY', source: H264_FULL_HD, output: { ...H264_FULL_HD, bitrate: null } },
    })
    serve([MOVIE, { ...EPISODE, decision: unknownOutput }])
    renderAppAt(PAGE)
    await streamCard(MOVIE_CARD)

    expect(screen.getByText('1 copy, 1 encode')).toBeInTheDocument()
  })

  it.each([
    { audio: 'no audio', track: null },
    {
      audio: 'copied audio',
      track: { delivery: 'COPY', source: AAC_STEREO, output: AAC_STEREO } as const,
    },
  ])(
    'shouldLeaveTheDeliveryOutWhenTheServerSendsOneThePageDoesNotKnow(audio: $audio)',
    async ({ track }) => {
      const future = playbackDecision({
        streamSessionId: 'sess-future',
        video: {
          delivery: 'SPLICE' as PlaybackDelivery,
          source: H264_FULL_HD,
          output: H264_FULL_HD,
        },
        audio: track,
      })
      serve([{ ...MOVIE, decision: future }])
      renderAppAt(PAGE)

      await streamCard('Everlight, Ada. Playing.')

      expect(
        screen
          .getAllByRole('button')
          .filter((button) => button.hasAttribute('aria-pressed'))
          .map((chip) => chip.textContent),
      ).toEqual(['All 1'])
    },
  )

  it.each([
    { focus: 'its open card', place: () => undefined },
    {
      focus: 'its details',
      place: (details: HTMLElement) =>
        within(details).getByRole('button', { name: 'Close details' }).focus(),
    },
  ])(
    'shouldMoveFocusToTheNextCardWhenAStreamEndsWhileFocusIsOn(focus: $focus)',
    async ({ place }) => {
      const state = serve([MOVIE, EPISODE])
      const { user } = renderAppAt(PAGE)
      const details = await openDetails(user, MOVIE_CARD, 'Everlight')
      place(details)
      await liveChanges(state)

      publishChange(state, MOVIE.playbackSessionId, null)

      await waitFor(() => expect(screen.getByRole('button', { name: EPISODE_CARD })).toHaveFocus())
    },
  )

  it('shouldListTheWorkersAlphabeticallyWhateverTheirCase', async () => {
    serve([
      { ...MOVIE, workers: ['worker-b'] },
      { ...EPISODE, workers: ['Worker-c', 'worker-a'] },
    ])
    const { user } = renderAppAt(PAGE)
    await streamCard(MOVIE_CARD)

    await user.click(screen.getByRole('button', { name: 'Any worker' }))

    expect(
      within(screen.getByRole('menu', { name: 'Worker' }))
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(['Any worker', 'worker-a', 'worker-b', 'Worker-c'])
  })

  it('shouldFindTheStreamsWhoseViewerTitleOrDeviceMatchesTheSearch', async () => {
    serve()
    const { user } = renderAppAt(PAGE)
    await streamCard(MOVIE_CARD)
    const search = screen.getByRole('searchbox', { name: 'Search viewers, titles and devices' })

    await user.type(search, 'apple TV')

    expect(cardNames()).toEqual([EPISODE_CARD])

    await user.clear(search)
    await user.type(search, 'breakage')

    expect(cardNames()).toEqual([EPISODE_CARD])

    await user.type(search, ' extended')

    expect(cardNames()).toEqual([])
    expect(screen.getByText('No stream matches.')).toBeInTheDocument()
  })

  it.each([
    { sort: 'Title', shown: [ZOE_MOVIE_CARD, EPISODE_CARD] },
    { sort: 'Time left', shown: [ZOE_MOVIE_CARD, EPISODE_CARD] },
  ])('shouldOrderTheStreamsByTheSortTheAdminPicks(sort: $sort)', async ({ sort, shown }) => {
    // Zoe sorts after Ben, and her movie has less left than his episode, so both picks reorder.
    serve([
      { ...EPISODE, positionSeconds: 60 },
      { ...MOVIE, profile: { id: 'profile-zoe', name: 'Zoe' }, positionSeconds: 7_000 },
    ])
    const { user } = renderAppAt(PAGE)
    await streamCard(ZOE_MOVIE_CARD)

    expect(cardNames()).toEqual([EPISODE_CARD, ZOE_MOVIE_CARD])

    await user.click(screen.getByRole('button', { name: 'Sort: Viewer' }))
    await user.click(screen.getByRole('menuitemradio', { name: sort }))

    expect(cardNames()).toEqual(shown)
  })

  it('shouldSayNothingPlaysWhenNoStreamIsActive', async () => {
    serve([])
    renderAppAt(PAGE)

    expect(await screen.findByText('Nothing is playing right now.')).toBeInTheDocument()
  })

  it('shouldAddAStreamThatStartsWhileThePageShows', async () => {
    const state = serve([MOVIE])
    renderAppAt(PAGE)
    await streamCard(MOVIE_CARD)
    await liveChanges(state)

    publishChange(state, EPISODE.playbackSessionId, EPISODE)

    await streamCard(EPISODE_CARD)
    expect(cardNames()).toEqual([MOVIE_CARD, EPISODE_CARD])
  })

  it('shouldShowAStreamsNewPositionAndStateInItsOpenDetailsWhenItChanges', async () => {
    const state = serve([MOVIE])
    const { user } = renderAppAt(PAGE)
    const details = await openDetails(user, MOVIE_CARD, 'Everlight')
    await liveChanges(state)

    publishChange(state, MOVIE.playbackSessionId, {
      ...MOVIE,
      positionSeconds: 800,
      state: 'PAUSED',
    })

    await waitFor(() => expect(factsIn(details).Position).toBe('13:20 · Paused'))
    expect(cardNames()).toEqual(['Everlight, Ada. Paused, Encode.'])
  })

  it('shouldDropAStreamThatEndsAndSayNothingPlaysOnceTheLastEnds', async () => {
    const state = serve([MOVIE, EPISODE])
    renderAppAt(PAGE)
    await streamCard(MOVIE_CARD)
    await liveChanges(state)

    publishChange(state, MOVIE.playbackSessionId, null)
    await waitFor(() => expect(cardNames()).toEqual([EPISODE_CARD]))
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
    state.listed = [{ ...EPISODE, state: 'PLAYING' }]
    read.resolve()

    await streamCard('Northern Line, S2 E5 · Breakage, Ben. Playing, Copy.')
    expect(cardNames()).toEqual(['Northern Line, S2 E5 · Breakage, Ben. Playing, Copy.'])
  })

  it('shouldReadAgainAfterTheReadStillOutWhenTheSocketSubscribesAgainMeanwhile', async () => {
    const state = serve([MOVIE, EPISODE])
    renderAppAt(PAGE)
    await streamCard(MOVIE_CARD)
    await liveChanges(state)
    const read = deferred()
    state.heldOnce = read.promise
    const readsBefore = state.reads
    // A read in flight absorbs the network's return, so the network returns until one more is out.
    await waitFor(() => {
      if (state.reads === readsBefore) window.dispatchEvent(new Event('online'))
      expect(state.reads).toBe(readsBefore + 1)
    })
    const subscribes = () => state.socket.state.subscribes.filter((name) => name === CHANGED)

    state.listed = [EPISODE]
    state.socket.closeAll(1001, 'Going away')
    // `isLive` holds the closed socket's operation until its close event, so this counts frames.
    await waitFor(() => expect(subscribes()).toHaveLength(2), {
      timeout: SOCKET_RECONNECT_DEADLINE_MS,
    })
    read.resolve()

    await waitFor(() => expect(cardNames()).toEqual([EPISODE_CARD]))
    expect(state.reads).toBe(readsBefore + 2)
  })

  it('shouldAnswerARetryWithItsOwnReadWhenAnotherReadIsStillOut', async () => {
    const state = serve([MOVIE, EPISODE])
    state.failing = true
    const { user } = renderAppAt(PAGE)
    const retry = await screen.findByRole('button', { name: 'Retry' })
    await liveChanges(state)
    state.failing = false
    state.heldOnce = deferred().promise
    const readsBefore = state.reads
    comeBackOnline()
    await waitFor(() => expect(state.reads).toBeGreaterThan(readsBefore))

    publishChange(state, MOVIE.playbackSessionId, null)
    state.listed = [EPISODE]
    await user.click(retry)

    await waitFor(() => expect(cardNames()).toEqual([EPISODE_CARD]))
  })

  it('shouldReadTheListAgainWhenTheSocketSubscribesAgainAfterAGap', async () => {
    const state = serve([MOVIE])
    renderAppAt(PAGE)
    await streamCard(MOVIE_CARD)
    await liveChanges(state)
    const readsBefore = state.reads

    state.listed = [EPISODE]
    state.socket.closeAll(1001, 'Going away')

    await waitFor(() => expect(cardNames()).toEqual([EPISODE_CARD]), {
      timeout: SOCKET_RECONNECT_DEADLINE_MS,
    })
    expect(state.reads).toBeGreaterThan(readsBefore)
  })

  it.each([
    {
      event: 'the network returns',
      returnToThePage: comeBackOnline,
    },
    {
      event: 'the page returns from the background',
      returnToThePage: () => {
        let visibility: DocumentVisibilityState = 'hidden'
        vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
        document.dispatchEvent(new Event('visibilitychange'))
        visibility = 'visible'
        document.dispatchEvent(new Event('visibilitychange'))
      },
    },
  ])('shouldReadTheListAgainWhen(event: $event)', async ({ returnToThePage }) => {
    const state = serve([MOVIE])
    renderAppAt(PAGE)
    await streamCard(MOVIE_CARD)
    await liveChanges(state)
    state.listed = [{ ...MOVIE, state: 'PAUSED' }]

    act(returnToThePage)

    expect(await streamCard('Everlight, Ada. Paused, Encode.')).toBeInTheDocument()
  })

  it('shouldGiveUpOnAReadThatNeverAnswersSoTheNextGapReadsAgain', async () => {
    const state = serve([MOVIE])
    renderAppAt(PAGE)
    await streamCard(MOVIE_CARD)
    await liveChanges(state)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    state.heldOnce = new Promise(() => undefined)
    const readsBefore = state.reads
    comeBackOnline()
    await vi.waitFor(() => expect(state.reads).toBeGreaterThan(readsBefore))

    await act(() => vi.advanceTimersByTimeAsync(ACTIVE_STREAMS_READ_DEADLINE_MS))
    vi.useRealTimers()
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
    state.listed = [EPISODE]
    comeBackOnline()

    await waitFor(() => expect(cardNames()).toEqual([EPISODE_CARD]))
  })

  it('shouldKeepTheCardAndReadAgainWhenAChangeArrivesWithoutItsStream', async () => {
    const state = serve([MOVIE])
    renderAppAt(PAGE)
    await streamCard(MOVIE_CARD)
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

    expect(cardNames()).toEqual([MOVIE_CARD])
    reread.resolve()
    expect(await streamCard('Everlight, Ada. Paused, Encode.')).toBeInTheDocument()
  })

  it('shouldKeepLiveUpdatesAndReadAgainWhenAChangeFailsWhileTheSubscriptionRuns', async () => {
    const state = serve([MOVIE])
    renderAppAt(PAGE)
    await streamCard(MOVIE_CARD)
    await liveChanges(state)
    const readsBefore = state.reads

    state.socket.publish(CHANGED, {
      data: { activeStreamsChanged: null },
      errors: [{ message: 'Internal failure', path: ['activeStreamsChanged'] }],
    })
    await waitFor(() => expect(state.reads).toBeGreaterThan(readsBefore))
    publishChange(state, MOVIE.playbackSessionId, { ...MOVIE, state: 'PAUSED' })

    expect(await streamCard('Everlight, Ada. Paused, Encode.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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
      await streamCard(MOVIE_CARD)
      await liveChanges(state)

      state.socket.publish(CHANGED, { errors })
      state.socket.complete(CHANGED)

      expect(await screen.findByRole('alert')).toHaveTextContent(shown)
      expect(await streamCard(MOVIE_CARD)).toBeInTheDocument()
    },
  )

  it('shouldReadTheListAgainWhenTheAdminRetriesAFailedRead', async () => {
    const state = serve([MOVIE])
    state.failing = true
    const { user } = renderAppAt(PAGE)
    const retry = await screen.findByRole('button', { name: 'Retry' })

    state.failing = false
    await user.click(retry)

    expect(await streamCard(MOVIE_CARD)).toBeInTheDocument()
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

    expect(await streamCard(MOVIE_CARD)).toBeInTheDocument()
    expect(within(rail).getByRole('link', { name: 'Active streams' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
