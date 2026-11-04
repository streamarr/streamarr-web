import { expect, test, type Page } from '@playwright/test'
import { meFixture, profileFixture } from '../src/test/meFixture'
import { routeGraphqlSocket } from './graphqlSocket'

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
}
const AAC = { __typename: 'AudioFormat', codec: 'aac', channels: 2, bitrate: 128_000 }

// A movie encoded from HEVC for a browser that declares none, its audio copied.
const MOVIE = {
  __typename: 'ActiveStream',
  playbackSessionId: 'playback-movie',
  profile: { __typename: 'ActiveStreamProfile', id: 'profile-ada', name: 'Ada' },
  deviceName: 'Safari on Mac',
  mediaFileId: 'file-movie',
  title: 'Everlight',
  seriesTitle: null,
  seasonNumber: null,
  episodeNumber: null,
  positionSeconds: 754,
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
  title: 'Breakage',
  seriesTitle: 'Northern Line',
  seasonNumber: 2,
  episodeNumber: 5,
  positionSeconds: null,
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

test('the active streams page shows a stream that starts and drops one that ends, live', async ({
  page,
}) => {
  const state = await fixture(page, [MOVIE])
  await page.goto(PAGE)
  const movie = page.getByRole('article', { name: 'Everlight' })
  await expect(movie).toContainText('Ada')
  await expect(movie).toContainText('12:34 · Playing')
  await expect(movie).toContainText("This device can't play the video's codec (HEVC).")
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
  const episode = page.getByRole('article', { name: 'Northern Line · S2 E5 · Breakage' })
  await expect(episode).toContainText('Preparing')

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
  await expect(episode).toBeVisible()
})

test('on a phone held upright each active stream fits the screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await fixture(page, [MOVIE, EPISODE])
  await page.goto(PAGE)

  const movie = page.getByRole('article', { name: 'Everlight' })
  await expect(movie).toContainText('Encode')
  const box = await movie.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(375)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
})
