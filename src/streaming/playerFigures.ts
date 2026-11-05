import type {
  PlayerFiguresInput,
  PlayerHdrMode as ServerHdrMode,
  VideoRange,
} from '../graphql/generated/graphql'
import { browserOf, browserVersionText, type BrowserVersion } from './browserText'
import { bitrateText, channelsText, UNKNOWN } from './playbackDecisionText'
import type { StreamStats } from './playerPlayback'

type Maybe<Value> = Value | null

/** The dynamic range that a player or display reports for what it shows. */
export type PlayerHdrMode = Exclude<ServerHdrMode, '%future added value'>

/**
 * The figures of the Playback data panel, as values. A figure that the player does not know is
 * absent; a figure read back from a shared report is null instead. A bitrate is in bits per second.
 */
export interface PlayerFigureValues {
  qualityStep?: Maybe<{ number: number; count: number; height: number; bitrate: number }>
  observedBitrate?: Maybe<number>
  bufferSeconds?: Maybe<number>
  droppedFrames?: Maybe<number>
  stalls?: Maybe<number>
  resolution?: Maybe<{ width: number; height: number }>
  videoCodec?: Maybe<string>
  hdrMode?: Maybe<string>
  audio?: Maybe<{ codec: string; channels?: Maybe<number>; dolbyAtmos?: Maybe<boolean> }>
}

/** What the browser reports of the screen that shows the player, and of itself. */
export interface ScreenFigureValues {
  screen?: Maybe<{ width: number; height: number; pixelRatio: number; hdr: boolean }>
  browser?: Maybe<BrowserVersion>
}

const HDR_MODES: Readonly<Record<PlayerHdrMode, string>> = {
  SDR: 'SDR',
  HDR: 'HDR',
  HDR10: 'HDR10',
  HDR10_PLUS: 'HDR10+',
  HLG: 'HLG',
  DOLBY_VISION: 'Dolby Vision',
}

// PQ, which HDR10 and PQ10 share, reads as HDR10.
const RANGE_MODES: Readonly<Record<string, PlayerHdrMode>> = { SDR: 'SDR', PQ: 'HDR10', HLG: 'HLG' }

const seconds = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })
const counts = new Intl.NumberFormat('en-US')
const pixelRatios = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

/** The player's figures as the element and the player library report them at this moment. */
export function capturePlayerFigures({
  video,
  stats,
  videoRange,
  playsHls,
}: {
  video: HTMLVideoElement | null
  stats: StreamStats
  videoRange: VideoRange
  /** Whether hls.js plays the stream, rather than the element playing the source file directly. */
  playsHls: boolean
}): PlayerFigureValues {
  const { variant, audioCodec, audioChannels } = stats
  return {
    qualityStep: variant && {
      number: variant.step,
      count: variant.steps,
      height: variant.height,
      bitrate: variant.bitrate,
    },
    observedBitrate: stats.bandwidthEstimate,
    bufferSeconds: video ? bufferedAhead(video) : 0,
    droppedFrames: droppedFrames(video),
    stalls: stats.stalls,
    resolution:
      video && video.videoWidth > 0
        ? { width: video.videoWidth, height: video.videoHeight }
        : undefined,
    videoCodec: stats.videoCodec,
    hdrMode: hdrMode(stats, { videoRange, playsHls }),
    // The element and hls.js report no Dolby Atmos either way, so the report leaves it out.
    audio: audioCodec ? { codec: audioCodec, channels: audioChannels } : undefined,
  }
}

/*
 * Dolby Vision rides on a PQ or HLG base, so over HLS only the playing variant's codecs tell an
 * HDR stream from Dolby Vision. This client declares no Dolby Vision for direct play, so a file
 * plays its base.
 */
function hdrMode(
  { dolbyVision }: StreamStats,
  { videoRange, playsHls }: { videoRange: VideoRange; playsHls: boolean },
): string | undefined {
  if (dolbyVision) {
    return 'DOLBY_VISION'
  }
  if (playsHls && videoRange !== 'SDR' && dolbyVision === undefined) {
    return undefined
  }
  return Object.hasOwn(RANGE_MODES, videoRange) ? RANGE_MODES[videoRange] : videoRange
}

/** What the browser reports of its screen and of itself. */
export function captureScreenFigures({
  screen,
  displaysHighDynamicRange,
  userAgent,
}: {
  screen: { width: number; height: number; pixelRatio: number }
  displaysHighDynamicRange: boolean
  userAgent: string
}): ScreenFigureValues {
  return {
    screen: { ...screen, hdr: displaysHighDynamicRange },
    browser: browserOf(userAgent) ?? undefined,
  }
}

/**
 * The figures as a shared playback report carries them. A figure that the player does not know,
 * and a dynamic range that the server would not know, are left out.
 */
export function playerFiguresInput(
  player: PlayerFigureValues,
  { screen, browser }: ScreenFigureValues,
): PlayerFiguresInput {
  const { hdrMode, audio, ...figures } = player
  return withoutAbsent({
    ...figures,
    hdrMode: hdrMode && isPlayerHdrMode(hdrMode) ? hdrMode : undefined,
    audio: audio && withoutAbsent(audio),
    screen,
    browser,
  })
}

// Leaves out each absent figure, so that a report names only what the player knew.
function withoutAbsent<Figures extends object>(figures: Figures): Figures {
  return Object.fromEntries(
    Object.entries(figures).filter(([, value]) => value !== null && value !== undefined),
  ) as Figures
}

/** The player's figures by the names that the panel shows them under. */
export function playerFigureFacts(figures: PlayerFigureValues): Record<string, string> {
  return {
    'Quality step': qualityStepText(figures.qualityStep),
    'Observed bitrate': known(figures.observedBitrate, bitrateText),
    Buffer: known(figures.bufferSeconds, (buffer) => `${seconds.format(buffer)} s`),
    'Dropped frames': known(figures.droppedFrames, (dropped) => counts.format(dropped)),
    Stalls: known(figures.stalls, (stalls) => counts.format(stalls)),
    Resolution: known(figures.resolution, ({ width, height }) => `${width}×${height}`),
    'Video codec': figures.videoCodec ?? UNKNOWN,
    'HDR mode': known(figures.hdrMode, hdrModeText),
    Audio: known(figures.audio, audioText),
  }
}

/** The screen's figures by the names that the panel shows them under. */
export function screenFigureFacts({ screen, browser }: ScreenFigureValues): Record<string, string> {
  return {
    Screen: known(
      screen,
      ({ width, height, pixelRatio }) => `${width}×${height} at ${pixelRatios.format(pixelRatio)}×`,
    ),
    'HDR display': known(screen, ({ hdr }) => (hdr ? 'Yes' : 'No')),
    Browser: browserVersionText(browser),
  }
}

/** A dynamic range as viewers know it; one this app does not know reads as it is named. */
export function hdrModeText(mode: string): string {
  return isPlayerHdrMode(mode) ? HDR_MODES[mode] : mode
}

/** Whether this app knows the dynamic range. */
export function isPlayerHdrMode(mode: string): mode is PlayerHdrMode {
  return Object.hasOwn(HDR_MODES, mode)
}

function known<Value>(value: Maybe<Value> | undefined, text: (value: Value) => string): string {
  return value === null || value === undefined ? UNKNOWN : text(value)
}

function qualityStepText(step: PlayerFigureValues['qualityStep']): string {
  return known(
    step,
    ({ height, bitrate, number, count }) =>
      `${height}p · ${bitrateText(bitrate)} (${number} of ${count})`,
  )
}

function audioText({
  codec,
  channels,
  dolbyAtmos,
}: NonNullable<PlayerFigureValues['audio']>): string {
  const parts = [codec]
  if (channels !== null && channels !== undefined) {
    parts.push(channelsText(channels))
  }
  if (dolbyAtmos) {
    parts.push('Atmos')
  }
  return parts.join(' ')
}

// The seconds the element holds past the playhead, in the buffered range that holds the playhead.
function bufferedAhead(video: HTMLVideoElement): number {
  const { buffered, currentTime } = video
  for (let index = 0; index < buffered.length; index++) {
    if (buffered.start(index) <= currentTime && currentTime <= buffered.end(index)) {
      return buffered.end(index) - currentTime
    }
  }
  return 0
}

function droppedFrames(video: HTMLVideoElement | null): number | undefined {
  // Not every browser reports decoded frames; TypeScript's DOM library declares that it does.
  const quality = (video as Partial<HTMLVideoElement> | null)?.getVideoPlaybackQuality?.()
  return quality?.droppedVideoFrames
}
