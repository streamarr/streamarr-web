import Hls, { type HlsConfig, type VideoRange } from 'hls.js'
import { HttpResponse, http } from 'msw'
import { expect, onTestFinished, vi } from 'vitest'
import { server } from './server'

export const LADDER_URL = 'https://streamarr.test/api/stream/ladder/'

export interface ListedVariant {
  /** The variant's media playlist, relative to the multivariant playlist. */
  playlist: string
  bandwidth: number
  height: number
  range: VideoRange
}

// A copy of a 1080p source that peaks at 20 Mb/s, listed first as the server lists a copy in Auto
// (streamarr/streamarr-server#759), above its 720p and 360p H.264 encodes: each encode's tier video
// bitrate plus 128 kb/s of audio, and 20% over that for its peak.
export const COPY_LADDER: readonly ListedVariant[] = [
  { playlist: 'stream.m3u8', bandwidth: 20_000_000, height: 1080, range: 'SDR' },
  { playlist: '720p/stream.m3u8', bandwidth: 3_753_600, height: 720, range: 'SDR' },
  { playlist: '360p/stream.m3u8', bandwidth: 1_113_600, height: 360, range: 'SDR' },
]

function multivariantOf(variants: readonly ListedVariant[]): string {
  return [
    '#EXTM3U',
    ...variants.flatMap(({ playlist, bandwidth, height, range }) => [
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${(height * 16) / 9}x${height},CODECS="avc1.640028,mp4a.40.2",VIDEO-RANGE=${range}`,
      playlist,
    ]),
    '',
  ].join('\n')
}

const ONE_SEGMENT_MEDIA_PLAYLIST = [
  '#EXTM3U',
  '#EXT-X-TARGETDURATION:6',
  '#EXT-X-PLAYLIST-TYPE:VOD',
  '#EXTINF:6.0,',
  'segment0.m4s',
  '#EXT-X-ENDLIST',
  '',
].join('\n')

// Loads a multivariant playlist that lists `variants` into hls.js with `config`, and records each
// media playlist that hls.js asks for. hls.js asks for no media segment, as no element is attached.
export async function loadLadder(
  variants: readonly ListedVariant[],
  config: (player: () => Hls) => Partial<HlsConfig>,
) {
  vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
  const mediaPlaylists: string[] = []
  server.use(
    http.get(`${LADDER_URL}multivariant.m3u8`, () => HttpResponse.text(multivariantOf(variants))),
    http.get(`${LADDER_URL}*`, ({ request }) => {
      mediaPlaylists.push(request.url.slice(LADDER_URL.length))
      return HttpResponse.text(ONE_SEGMENT_MEDIA_PLAYLIST)
    }),
  )
  const hls: Hls = new Hls(config(() => hls))
  onTestFinished(() => hls.destroy())
  hls.loadSource(`${LADDER_URL}multivariant.m3u8`)
  await vi.waitFor(() => expect(mediaPlaylists).not.toHaveLength(0))
  return { hls, mediaPlaylists }
}
