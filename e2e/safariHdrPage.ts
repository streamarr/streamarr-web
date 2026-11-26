import Hls from 'hls.js'
import { hlsPlaybackConfig } from '../src/streaming/hlsPlaybackConfig'
import { hlsVideoPreference } from '../src/streaming/hlsVideoPreference'
import {
  browserPlaybackPlatform,
  declarePlaybackCapabilities,
} from '../src/streaming/playbackCapabilities'
import type { HdrFixture, HdrRecord, Playback, SafariHdrRecording } from './safariHdr'

// The page of record-safari-hdr.ts, which Vite's dev server serves. recordSafariHdr asks the
// platform about each fixture, builds the web client's declaration, and plays each fixture muted,
// first through hls.js with the player's settings and the declaration's video preference, then in
// the element's own HLS player.

declare global {
  interface Window {
    recordSafariHdr?: (
      fixtures: { fixture: HdrFixture; url: string }[],
      picture: { width: number; height: number; framerate: number; bitrate: number },
    ) => Promise<SafariHdrRecording>
  }
}

const PLAYBACK_DEADLINE_MS = 20_000
// The fixtures last 4 s in 2 s segments: past 2.5 s, the element has played into the second.
const PLAYED_SECONDS = 2.5

type Picture = Parameters<NonNullable<Window['recordSafariHdr']>>[1]

interface MediaSourceType {
  isTypeSupported: (type: string) => boolean
}

function flags(answer: MediaCapabilitiesDecodingInfo): string {
  return [
    answer.supported ? 'S' : '-',
    answer.smooth ? 'm' : '-',
    answer.powerEfficient ? 'p' : '-',
  ].join('')
}

async function decodingInfo(type: MediaDecodingType, video: VideoConfiguration): Promise<string> {
  try {
    return flags(await navigator.mediaCapabilities.decodingInfo({ type, video }))
  } catch (error) {
    return `threw ${(error as Error).name}`
  }
}

async function askAbout(fixture: HdrFixture, picture: Picture): Promise<Record<string, string>> {
  const scope: { MediaSource?: MediaSourceType; ManagedMediaSource?: MediaSourceType } = globalThis
  const color: Partial<VideoConfiguration> = {
    colorGamut: 'rec2020',
    transferFunction: fixture.videoRange === 'PQ' ? 'pq' : 'hlg',
  }
  if (fixture.videoRange === 'PQ') {
    color.hdrMetadataType = 'smpteSt2086'
  }
  const codecs = [fixture.codecs]
  if (fixture.supplementalCodecs) {
    codecs.push(fixture.supplementalCodecs.split('/')[0])
  }
  const answers: Record<string, string> = {}
  const video = document.createElement('video')
  for (const codec of codecs) {
    const contentType = `video/mp4; codecs="${codec}"`
    const question = { contentType, ...picture, ...color }
    answers[`decodingInfo media-source ${codec}`] = await decodingInfo('media-source', question)
    answers[`decodingInfo file ${codec}`] = await decodingInfo('file', question)
    answers[`MediaSource.isTypeSupported ${codec}`] = String(
      scope.MediaSource?.isTypeSupported(contentType) ?? 'absent',
    )
    answers[`ManagedMediaSource.isTypeSupported ${codec}`] = String(
      scope.ManagedMediaSource?.isTypeSupported(contentType) ?? 'absent',
    )
    answers[`canPlayType ${codec}`] = video.canPlayType(contentType) || '""'
  }
  return answers
}

function frameColorSpace(video: HTMLVideoElement): Playback['frameColorSpace'] {
  try {
    const frame = new VideoFrame(video)
    const { primaries, transfer } = frame.colorSpace
    frame.close()
    return { primaries, transfer }
  } catch {
    return null
  }
}

// Resolves once the element plays past PLAYED_SECONDS, fails, or reaches the deadline.
async function watch(video: HTMLVideoElement, errors: string[]): Promise<Playback> {
  const outcome = await new Promise<boolean>((resolve) => {
    const deadline = setTimeout(() => {
      errors.push(`Playback did not pass ${PLAYED_SECONDS} s within ${PLAYBACK_DEADLINE_MS} ms`)
      resolve(false)
    }, PLAYBACK_DEADLINE_MS)
    video.addEventListener('timeupdate', () => {
      if (video.currentTime >= PLAYED_SECONDS) {
        clearTimeout(deadline)
        resolve(true)
      }
    })
    video.addEventListener('error', () => {
      errors.push(`media error ${video.error?.code}: ${video.error?.message}`)
      clearTimeout(deadline)
      resolve(false)
    })
    video.play().catch((error: unknown) => errors.push(`play() failed: ${String(error)}`))
  })
  return {
    played: outcome && errors.length === 0,
    sourceBufferCodec: null,
    videoRange: null,
    frameColorSpace: outcome ? frameColorSpace(video) : null,
    errors,
  }
}

function mutedVideo(): HTMLVideoElement {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  document.body.append(video)
  return video
}

async function playThroughHlsJs(
  url: string,
  videoPreference: Parameters<typeof hlsPlaybackConfig>[1],
): Promise<Playback> {
  const video = mutedVideo()
  const errors: string[] = []
  let sourceBufferCodec: string | null = null
  let videoRange: string | null = null
  const hls: Hls = new Hls(hlsPlaybackConfig(() => hls, videoPreference))
  hls.on(Hls.Events.BUFFER_CODECS, (_, data) => {
    sourceBufferCodec = data.video?.codec ?? null
  })
  hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
    videoRange = hls.levels[data.level]?.videoRange ?? null
  })
  hls.on(Hls.Events.ERROR, (_, data) => {
    if (data.fatal) {
      errors.push(`hls.js fatal ${data.details}: ${data.error?.message}`)
    }
  })
  hls.attachMedia(video)
  hls.loadSource(url)
  try {
    const playback = await watch(video, errors)
    return { ...playback, sourceBufferCodec, videoRange }
  } finally {
    hls.destroy()
    video.remove()
  }
}

async function playNatively(url: string): Promise<Playback> {
  const video = mutedVideo()
  video.src = url
  try {
    return await watch(video, [])
  } finally {
    video.removeAttribute('src')
    video.load()
    video.remove()
  }
}

window.recordSafariHdr = async (fixtures, picture) => {
  const platform = browserPlaybackPlatform(document.createElement('video'))
  const declaration = await declarePlaybackCapabilities(platform)
  const videoPreference = hlsVideoPreference(declaration, 'HDR')
  const records: HdrRecord[] = []
  for (const { fixture, url } of fixtures) {
    records.push({
      fixture: fixture.name,
      answers: await askAbout(fixture, picture),
      hlsJs: await playThroughHlsJs(url, videoPreference),
      native: await playNatively(url),
    })
  }
  return {
    userAgent: navigator.userAgent,
    displaysHighDynamicRange: platform.displaysHighDynamicRange,
    declaredHevc: declaration.video
      .filter((entry) => entry.hls && entry.codecFamily === 'HEVC')
      .map((entry) => ({
        compatibleBases: entry.compatibleBases,
        dolbyVisionProfiles: entry.dolbyVisionProfiles.map(
          ({ profile, maxLevel }) => `${profile} level ${maxLevel}`,
        ),
      })),
    fixtures: records,
  }
}
