// Asks decodingInfo about each audio codec that the capability declaration probes, at channel
// counts from 1 to 32. The spec runs recordDecodingInfo in Playwright's engines.
// record-safari-decoding-info.ts runs it in real Safari. Each browser receives the function's
// source text, so the function refers to nothing outside its body.

export interface ChannelCountProbe {
  /** The codecs parameter of each audio codec, keyed by the declaration's codec name. */
  codecs: Record<string, string>
  channelCounts: number[]
  decodingTypes: MediaDecodingType[]
  /** The bitrate and sample rate the capability declaration asks with. */
  bitrate: number
  samplerate: number
}

/** decodingInfo's answers, by codec, then decoding type, then channel count. */
export type ChannelCountAnswers = Record<string, Record<string, Record<string, string>>>

export interface ChannelCountRecord {
  userAgent: string
  answers: ChannelCountAnswers
}

export const CHANNEL_COUNT_PROBE: ChannelCountProbe = {
  codecs: {
    AAC: 'mp4a.40.2',
    AC3: 'ac-3',
    EAC3: 'ec-3',
    OPUS: 'opus',
    FLAC: 'flac',
    ALAC: 'alac',
  },
  channelCounts: [1, 2, 6, 7, 8, 16, 32],
  decodingTypes: ['media-source', 'file'],
  bitrate: 384_000,
  samplerate: 48_000,
}

export async function recordDecodingInfo(probe: ChannelCountProbe): Promise<ChannelCountRecord> {
  const describeAnswer = (answer: MediaCapabilitiesDecodingInfo): string => {
    if (!answer.supported) {
      return 'unsupported'
    }
    const smooth = answer.smooth ? 'smooth' : 'not smooth'
    const powerEfficient = answer.powerEfficient ? 'power-efficient' : 'not power-efficient'
    return `supported, ${smooth}, ${powerEfficient}`
  }
  const ask = async (configuration: MediaDecodingConfiguration): Promise<string> => {
    try {
      return describeAnswer(await navigator.mediaCapabilities.decodingInfo(configuration))
    } catch (error) {
      return `rejected: ${String(error)}`
    }
  }
  const answers: ChannelCountAnswers = {}
  for (const [codec, codecs] of Object.entries(probe.codecs)) {
    answers[codec] = {}
    for (const type of probe.decodingTypes) {
      answers[codec][type] = {}
      for (const channels of probe.channelCounts) {
        answers[codec][type][channels] = await ask({
          type,
          audio: {
            contentType: `audio/mp4; codecs="${codecs}"`,
            channels: String(channels),
            bitrate: probe.bitrate,
            samplerate: probe.samplerate,
          },
        })
      }
    }
  }
  return { userAgent: navigator.userAgent, answers }
}

/**
 * Each codec and decoding type whose answer changes with the channel count. Refusals at every
 * count also leave this list empty, so supportedFlacAnswersAboveItsLimit must find an answer too.
 */
export function answersThatDependOnChannelCount(answers: ChannelCountAnswers): string[] {
  return Object.entries(answers).flatMap(([codec, byType]) =>
    Object.entries(byType)
      .filter(([, byChannels]) => new Set(Object.values(byChannels)).size > 1)
      .map(([type, byChannels]) => `${codec} ${type}: ${JSON.stringify(byChannels)}`),
  )
}

// FLAC carries at most 8 channels.
const FLAC_CHANNEL_LIMIT = 8

/**
 * FLAC's supported answers at channel counts above 8. A browser that checks the count refuses
 * them all, so one such answer shows that the count goes unchecked.
 */
export function supportedFlacAnswersAboveItsLimit(answers: ChannelCountAnswers): string[] {
  return Object.entries(answers.FLAC ?? {}).flatMap(([type, byChannels]) =>
    Object.entries(byChannels)
      .filter(
        ([channels, answer]) =>
          Number(channels) > FLAC_CHANNEL_LIMIT && answer.startsWith('supported'),
      )
      .map(([channels, answer]) => `FLAC ${type} at ${channels} channels: ${answer}`),
  )
}
