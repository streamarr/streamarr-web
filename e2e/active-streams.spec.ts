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
  media: {
    __typename: 'Movie',
    id: 'movie-everlight',
    title: 'Everlight',
    runtime: 118,
    images: [],
  },
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

const MOVIE_CARD = 'Everlight, Ada. Playing, Encode.'
const EPISODE_CARD = 'Northern Line, S2 E5 · Breakage, Ben. Preparing.'

test('the active streams page shows a stream that starts and drops one that ends, live', async ({
  page,
}) => {
  const state = await fixture(page, [MOVIE])
  await page.goto(PAGE)
  const movie = page.getByRole('button', { name: MOVIE_CARD })
  await movie.click()
  const details = page.getByRole('region', { name: 'Everlight' })
  await expect(details).toContainText('Ada')
  await expect(details).toContainText('12:34 · Playing')
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
