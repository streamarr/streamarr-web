import { expect, test, type Page } from '@playwright/test'
import { meFixture, profileFixture } from '../src/test/meFixture'
import { routeGraphqlSocket } from './graphqlSocket'
import { videoFormatDetails } from '../src/test/videoFormatDetails'

test.use({ serviceWorkers: 'block' })

const PAGE = '/settings/server/streams'

const H264_HD = {
  __typename: 'VideoFormat',
  codec: 'h264',
  width: 1280,
  height: 720,
  frameRate: 25,
  bitrate: 1_800_000,
  videoRange: 'SDR',
  dolbyVision: false,
  details: null,
}
const AAC = { __typename: 'AudioFormat', codec: 'aac', channels: 2, bitrate: 128_000 }

// A movie encoded from HEVC for a browser that declares none, its audio copied.
const MOVIE = {
  __typename: 'ActiveStream',
  playbackSessionId: 'playback-movie',
  profile: { __typename: 'ActiveStreamProfile', id: 'profile-ada', name: 'Ada' },
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
  producedRange: { __typename: 'MediaTimeRange', startSeconds: 600, endSeconds: 1_500 },
  state: 'PLAYING',
  decision: {
    __typename: 'PlaybackDecision',
    formatAttempt: 1,
    streamSessionId: 'sess-movie',
    video: {
      __typename: 'VideoDelivery',
      delivery: 'ENCODE',
      source: { ...H264_HD, codec: 'hevc', bitrate: 6_000_000 },
      output: H264_HD,
    },
    audio: { __typename: 'AudioDelivery', delivery: 'COPY', source: AAC, output: AAC },
    reasons: ['VIDEO_CODEC_NOT_DECLARED'],
  },
  workers: ['worker-session-1'],
}

// An episode whose format attempt still prepares.
const EPISODE = {
  ...MOVIE,
  playbackSessionId: 'playback-episode',
  profile: { __typename: 'ActiveStreamProfile', id: 'profile-ben', name: 'Ben' },
  deviceName: 'Apple TV',
  media: {
    __typename: 'Episode',
    id: 'episode-breakage',
    title: 'Breakage',
    episodeNumber: 5,
    runtime: 52,
    season: {
      __typename: 'Season',
      id: 'season-northern-line-2',
      seasonNumber: 2,
      series: {
        __typename: 'Series',
        id: 'series-northern-line',
        title: 'Northern Line',
        images: [],
      },
    },
  },
  positionSeconds: null,
  producedRange: null,
  state: null,
  decision: null,
  workers: [],
}

async function fixture(page: Page, streams: unknown[]) {
  const state = { streams, socket: await routeGraphqlSocket(page) }
  const me = meFixture({
    scope: 'profile',
    profiles: [profileFixture({ selected: true })],
    serverAdmin: true,
  })
  await page.route('**/graphql', async (route) => {
    const { operationName } = route.request().postDataJSON() as { operationName: string }
    if (operationName === 'Me') return route.fulfill({ json: { data: { me } } })
    if (operationName === 'ActiveStreams')
      return route.fulfill({ json: { data: { activeStreams: state.streams } } })
    return route.continue()
  })
  return state
}

// A copy and a direct play beside the encode and the preparing stream, so every delivery has a chip.
const copy = {
  ...MOVIE,
  playbackSessionId: 'playback-copy',
  decision: { ...MOVIE.decision, video: { ...MOVIE.decision.video, delivery: 'COPY' } },
}
const directPlay = {
  ...MOVIE,
  playbackSessionId: 'playback-direct',
  decision: {
    ...MOVIE.decision,
    video: { ...MOVIE.decision.video, delivery: 'DIRECT_PLAY' },
    audio: { ...MOVIE.decision.audio, delivery: 'DIRECT_PLAY' },
  },
}

const MOVIE_CARD = 'Everlight, Ada. Playing, Encode.'
const EPISODE_CARD = 'Northern Line, S2 E5 · Breakage, Ben. Preparing.'

test('HDR source and output facts remain readable on a phone', async ({ page }) => {
  const sourceDetails = videoFormatDetails({
    compatibleBase: 'PQ',
    bitDepth: 10,
    hdr10Plus: 'ABSENT',
    dolbyVision: {
      presence: 'PRESENT',
      profile: 7,
      level: 6,
      baseLayerCompatibilityId: 6,
      enhancementLayer: 'FEL',
      observedRpu: 'PRESENT',
    },
    masteringDisplay: { minLuminance: 0.0001, maxLuminance: 1000 },
  })
  const outputDetails = {
    ...sourceDetails,
    dolbyVision: {
      ...sourceDetails.dolbyVision,
      profile: 8,
      baseLayerCompatibilityId: 1,
      enhancementLayer: 'NONE',
    },
    bitstreamRewrites: ['CONVERT_DOLBY_VISION_PROFILE_7_TO_8_1'],
  }
  await page.setViewportSize({ width: 375, height: 667 })
  await fixture(page, [
    {
      ...copy,
      decision: {
        ...copy.decision,
        video: {
          ...copy.decision.video,
          source: { ...H264_HD, codec: 'hevc', dolbyVision: true, details: sourceDetails },
          output: { ...H264_HD, codec: 'hevc', dolbyVision: true, details: outputDetails },
        },
      },
    },
  ])
  await page.goto(PAGE)
  await page.getByRole('button', { name: 'Everlight, Ada. Playing, Copy.' }).click()
  const details = page.getByRole('region', { name: 'Everlight' })
  await expect(details.getByRole('row', { name: /Dolby Vision profile/ })).toContainText(
    '7 · level 6',
  )
  await expect(details.getByRole('row', { name: /Dolby Vision profile/ })).toContainText(
    '8.1 · level 6',
  )
  const changes = details.getByRole('row', { name: /Bitstream changes/ })
  await changes.scrollIntoViewIfNeeded()
  await expect(changes).toContainText('enhancement layer removed')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await page.screenshot({ path: '/tmp/streamarr-hdr-details-mobile.png', fullPage: true })
})

test('the active streams page shows a stream that starts and drops one that ends, live', async ({
  page,
}) => {
  const state = await fixture(page, [MOVIE])
  await page.goto(PAGE)
  const movie = page.getByRole('button', { name: MOVIE_CARD })
  const track = movie.getByRole('progressbar', { name: 'Position' })
  const produced = await track.getByTestId('produced-range').boundingBox()
  const trackBox = await track.boundingBox()
  expect(produced!.x).toBeGreaterThan(trackBox!.x)
  expect(produced!.x + produced!.width).toBeLessThan(trackBox!.x + trackBox!.width)
  await movie.click()
  const details = page.getByRole('region', { name: 'Everlight' })
  await expect(details).toContainText('Ada')
  await expect(details).toContainText('12:34 · Playing')
  await expect(details).toContainText('10:00 to 25:00')
  await expect(details).toContainText("This device can't play the video's codec (HEVC).")
  await expect.poll(() => state.socket.isLive('ActiveStreamsChanged')).toBe(true)

  state.socket.publish('ActiveStreamsChanged', {
    data: {
      activeStreamsChanged: {
        __typename: 'ActiveStreamChange',
        playbackSessionId: EPISODE.playbackSessionId,
        activeStream: EPISODE,
      },
    },
  })
  const episode = page.getByRole('button', { name: EPISODE_CARD })
  await expect(episode).toBeVisible()

  state.socket.publish('ActiveStreamsChanged', {
    data: {
      activeStreamsChanged: {
        __typename: 'ActiveStreamChange',
        playbackSessionId: MOVIE.playbackSessionId,
        activeStream: null,
      },
    },
  })
  await expect(movie).toBeHidden()
  await expect(details).toBeHidden()
  await expect(episode).toBeVisible()
})

test('on a phone held upright the filters, each poster and the open details fit the screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await fixture(page, [MOVIE, EPISODE, copy, directPlay])
  await page.goto(PAGE)

  await page.getByRole('button', { name: MOVIE_CARD }).click()
  const details = page.getByRole('region', { name: 'Everlight' })
  await expect(details).toContainText('Encode')
  for (const box of [
    await page.getByRole('button', { name: EPISODE_CARD }).boundingBox(),
    await details.boundingBox(),
    // The details clip their content, so the close button at the panel's far edge shows a clipped panel.
    await details.getByRole('button', { name: 'Close details' }).boundingBox(),
  ]) {
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(375)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
})

test('with nothing playing, the title sits where the other settings pages put theirs', async ({
  page,
}) => {
  await fixture(page, [])
  const titleTop = async (path: string) => {
    await page.goto(path)
    return (await page.getByRole('heading', { level: 1 }).boundingBox())!.y
  }

  const streams = await titleTop(PAGE)
  await expect(page.getByText('Nothing is playing right now.')).toBeVisible()

  expect(Math.abs(streams - (await titleTop('/settings/server/encoding')))).toBeLessThanOrEqual(2)
})

test('on a desktop, the title of each settings page lines up with the top of the settings rail', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await fixture(page, [MOVIE])
  const rail = page.getByRole('navigation', { name: 'Server settings' })

  for (const path of [PAGE, '/settings/server/encoding']) {
    await page.goto(path)
    const title = (await page.getByRole('heading', { level: 1 }).boundingBox())!.y
    expect(Math.abs(title - (await rail.boundingBox())!.y), path).toBeLessThanOrEqual(4)
  }
})

test('on a phone, the delivery chips that do not fit fold into a menu that still filters', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await fixture(page, [MOVIE, EPISODE, copy, directPlay])
  await page.goto(PAGE)

  await page.getByRole('button', { name: /^\d+ more$/ }).click()
  const menu = page.getByRole('menu', { name: 'More deliveries' })
  await menu.getByRole('menuitemradio', { name: 'Preparing' }).click()

  await expect(
    page.getByRole('button', { name: 'Preparing', exact: true, expanded: false }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: EPISODE_CARD })).toBeVisible()
  await expect(page.getByRole('button', { name: MOVIE_CARD })).toBeHidden()
})

test('focus stays in the open details when a card before them in the row ends', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  // More streams than any row holds, so an ending card pulls the next row's first card up.
  const viewers = Array.from({ length: 9 }, (_, index) => ({
    ...MOVIE,
    playbackSessionId: `playback-viewer-${index + 1}`,
    profile: {
      __typename: 'ActiveStreamProfile',
      id: `profile-${index + 1}`,
      name: `Viewer ${index + 1}`,
    },
  }))
  const state = await fixture(page, viewers)
  await page.goto(PAGE)
  await page.getByRole('button', { name: 'Everlight, Viewer 1. Playing, Encode.' }).click()
  const close = page.getByRole('region', { name: 'Everlight' }).getByRole('button', {
    name: 'Close details',
  })
  await close.focus()
  await expect.poll(() => state.socket.isLive('ActiveStreamsChanged')).toBe(true)

  state.socket.publish('ActiveStreamsChanged', {
    data: {
      activeStreamsChanged: {
        __typename: 'ActiveStreamChange',
        playbackSessionId: 'playback-viewer-2',
        activeStream: null,
      },
    },
  })

  await expect(
    page.getByRole('button', { name: 'Everlight, Viewer 2. Playing, Encode.' }),
  ).toBeHidden()
  await expect(close).toBeFocused()
})
