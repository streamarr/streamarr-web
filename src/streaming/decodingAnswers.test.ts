import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browseIn, CHROME_USER_AGENT, IPHONE_SAFARI_USER_AGENT } from '../test/playbackCapabilities'
import { browserDecodingAnswers, createDecodingAnswers } from './decodingAnswers'
import type { DecodingAnswer } from './playbackCapabilities'

const SAFARI_ON_A_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Safari/605.1.15'
const CHROME_ON_THE_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1'
const FIREFOX =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0'

const SUPPORTED: DecodingAnswer = { supported: true, smooth: true, powerEfficient: true }
const SUPPORTED_BUT_NOT_SMOOTH: DecodingAnswer = {
  supported: true,
  smooth: false,
  powerEfficient: false,
}
const REFUSED: DecodingAnswer = { supported: false, smooth: false, powerEfficient: false }

const HEVC_AT_2160P60: MediaDecodingConfiguration = {
  type: 'media-source',
  video: {
    contentType: 'video/mp4; codecs="hvc1.2.4.L153.B0"',
    width: 3840,
    height: 2160,
    framerate: 60,
    bitrate: 40_000_000,
  },
}

const H264_AT_1080P30: MediaDecodingConfiguration = {
  type: 'media-source',
  video: {
    contentType: 'video/mp4; codecs="avc1.640028"',
    width: 1920,
    height: 1080,
    framerate: 30,
    bitrate: 10_000_000,
  },
}

const STEREO_AAC: MediaDecodingConfiguration = {
  type: 'media-source',
  audio: {
    contentType: 'audio/mp4; codecs="mp4a.40.2"',
    channels: '2',
    bitrate: 384_000,
    samplerate: 48_000,
  },
}

type DecodingInfo = (configuration: MediaDecodingConfiguration) => Promise<DecodingAnswer>

interface SentQuestion {
  resolve: (answer: DecodingAnswer) => void
  reject: (reason: unknown) => void
}

// A browser that settles each question only when the test settles it, in the order it was sent.
function browserAnsweringByHand() {
  const sent: SentQuestion[] = []
  const decodingInfo = vi.fn<DecodingInfo>(
    () =>
      new Promise<DecodingAnswer>((resolve, reject) => {
        sent.push({ resolve, reject })
      }),
  )
  return { decodingInfo, sent }
}

function askedConfigurations(decodingInfo: ReturnType<typeof vi.fn<DecodingInfo>>) {
  return decodingInfo.mock.calls.map(([configuration]) => configuration)
}

async function letTurnsPass(milliseconds: number) {
  await vi.advanceTimersByTimeAsync(milliseconds)
}

describe('createDecodingAnswers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['Smooth', SUPPORTED],
    ['NotSmooth', SUPPORTED_BUT_NOT_SMOOTH],
  ])(
    'shouldAnswerALaterAskWithoutTheBrowserWhenTheBrowserAnsweredSupportedAnd%s',
    async (_, supported) => {
      const decodingInfo = vi.fn<DecodingInfo>(() => Promise.resolve(supported))
      const { ask } = createDecodingAnswers({ decodingInfo })
      await ask(HEVC_AT_2160P60)

      const later = ask(HEVC_AT_2160P60)

      await expect(later).resolves.toEqual(supported)
      expect(decodingInfo).toHaveBeenCalledOnce()
    },
  )

  it('shouldGiveEachAskTheAnswerOfItsOwnSendingWhenTheBrowserRefusedTheQuestion', async () => {
    const decodingInfo = vi
      .fn<DecodingInfo>()
      .mockResolvedValueOnce(REFUSED)
      .mockResolvedValueOnce(SUPPORTED)
    const { ask } = createDecodingAnswers({ decodingInfo })
    const first = await ask(HEVC_AT_2160P60)

    const again = await ask(HEVC_AT_2160P60)

    expect([first, again]).toEqual([REFUSED, SUPPORTED])
    expect(decodingInfo).toHaveBeenCalledTimes(2)
  })

  it('shouldAnswerFromTheSupportedAnswerWithoutTheBrowserWhenTheBrowserRefusedTheQuestionBeforeIt', async () => {
    const decodingInfo = vi
      .fn<DecodingInfo>()
      .mockResolvedValueOnce(REFUSED)
      .mockResolvedValueOnce(SUPPORTED)
    const { ask } = createDecodingAnswers({ decodingInfo })
    await ask(HEVC_AT_2160P60)
    await ask(HEVC_AT_2160P60)

    const third = ask(HEVC_AT_2160P60)

    await expect(third).resolves.toEqual(SUPPORTED)
    expect(decodingInfo).toHaveBeenCalledTimes(2)
  })

  it('shouldSendAQuestionOnceForTwoAsksMadeWhileItIsPendingWhenTheBrowserRefusesIt', async () => {
    const browser = browserAnsweringByHand()
    const { ask } = createDecodingAnswers({ decodingInfo: browser.decodingInfo })
    const first = ask(HEVC_AT_2160P60)
    await letTurnsPass(100)
    const second = ask(HEVC_AT_2160P60)

    browser.sent[0].resolve(REFUSED)

    await expect(first).resolves.toEqual(REFUSED)
    await expect(second).resolves.toEqual(REFUSED)
    void ask(HEVC_AT_2160P60)
    await letTurnsPass(0)
    expect(askedConfigurations(browser.decodingInfo)).toEqual([HEVC_AT_2160P60, HEVC_AT_2160P60])
  })

  it('shouldAnswerFromTheBrowsersAnswerWhenALaterConfigurationListsItsFieldsInAnotherOrder', async () => {
    const decodingInfo = vi.fn<DecodingInfo>(() => Promise.resolve(SUPPORTED))
    const { ask } = createDecodingAnswers({ decodingInfo })
    await ask(HEVC_AT_2160P60)

    const later = ask({
      video: {
        bitrate: 40_000_000,
        framerate: 60,
        height: 2160,
        width: 3840,
        contentType: 'video/mp4; codecs="hvc1.2.4.L153.B0"',
      },
      type: 'media-source',
    })

    await expect(later).resolves.toEqual(SUPPORTED)
    expect(decodingInfo).toHaveBeenCalledOnce()
  })

  it.each<{ field: string; asked: MediaDecodingConfiguration; then: MediaDecodingConfiguration }>([
    {
      field: 'TheType',
      asked: HEVC_AT_2160P60,
      then: { ...HEVC_AT_2160P60, type: 'file' },
    },
    {
      field: 'TheVideoBitrate',
      asked: HEVC_AT_2160P60,
      then: { ...HEVC_AT_2160P60, video: { ...HEVC_AT_2160P60.video!, bitrate: 20_000_000 } },
    },
    {
      field: 'TheVideoTransferFunction',
      asked: HEVC_AT_2160P60,
      then: { ...HEVC_AT_2160P60, video: { ...HEVC_AT_2160P60.video!, transferFunction: 'pq' } },
    },
    {
      field: 'TheAudioChannelCount',
      asked: STEREO_AAC,
      then: { ...STEREO_AAC, audio: { ...STEREO_AAC.audio!, channels: '6' } },
    },
  ])('shouldAskTheBrowserAgainWhen$fieldDiffers', async ({ asked, then }) => {
    const decodingInfo = vi.fn<DecodingInfo>(() => Promise.resolve(SUPPORTED))
    const { ask } = createDecodingAnswers({ decodingInfo })
    await ask(asked)

    await ask(then)

    expect(askedConfigurations(decodingInfo)).toEqual([asked, then])
  })

  it('shouldRejectTheAskAndAskTheBrowserAgainWhenTheBrowserRejectedTheQuestion', async () => {
    const decodingInfo = vi
      .fn<DecodingInfo>()
      .mockRejectedValueOnce(new TypeError('Unsupported configuration'))
      .mockResolvedValueOnce(SUPPORTED)
    const { ask } = createDecodingAnswers({ decodingInfo })
    await expect(ask(HEVC_AT_2160P60)).rejects.toThrow('Unsupported configuration')

    const again = ask(HEVC_AT_2160P60)

    await expect(again).resolves.toEqual(SUPPORTED)
    expect(decodingInfo).toHaveBeenCalledTimes(2)
  })

  it('shouldRejectOnlyThatAskWhenTheBrowserThrowsSynchronously', async () => {
    const decodingInfo = vi.fn<DecodingInfo>((configuration) => {
      if (configuration.video?.width === 3840) {
        throw new TypeError('Unsupported configuration')
      }
      return Promise.resolve(SUPPORTED)
    })
    const { ask } = createDecodingAnswers({ decodingInfo })

    const refused = ask(HEVC_AT_2160P60)
    const answered = ask(H264_AT_1080P30)

    await expect(refused).rejects.toThrow('Unsupported configuration')
    await expect(answered).resolves.toEqual(SUPPORTED)
  })

  it('shouldSendEachQuestionOnlyAfterTheBrowserSettlesTheOneAskedBeforeIt', async () => {
    const browser = browserAnsweringByHand()
    const { ask } = createDecodingAnswers({ decodingInfo: browser.decodingInfo })
    void ask(HEVC_AT_2160P60)
    void ask(H264_AT_1080P30)
    void ask(STEREO_AAC)
    await letTurnsPass(0)
    expect(askedConfigurations(browser.decodingInfo)).toEqual([HEVC_AT_2160P60])

    browser.sent[0].resolve(SUPPORTED)
    await letTurnsPass(0)
    expect(askedConfigurations(browser.decodingInfo)).toEqual([HEVC_AT_2160P60, H264_AT_1080P30])

    browser.sent[1].resolve(SUPPORTED)
    await letTurnsPass(0)
    expect(askedConfigurations(browser.decodingInfo)).toEqual([
      HEVC_AT_2160P60,
      H264_AT_1080P30,
      STEREO_AAC,
    ])
  })

  it('shouldSendTheNextQuestionWhenTheBrowserRejectsTheOneBeforeIt', async () => {
    const browser = browserAnsweringByHand()
    const { ask } = createDecodingAnswers({ decodingInfo: browser.decodingInfo })
    const refused = ask(HEVC_AT_2160P60).catch(() => 'rejected')
    void ask(H264_AT_1080P30)
    await letTurnsPass(0)

    browser.sent[0].reject(new TypeError('Unsupported configuration'))
    await letTurnsPass(0)

    await expect(refused).resolves.toBe('rejected')
    expect(askedConfigurations(browser.decodingInfo)).toEqual([HEVC_AT_2160P60, H264_AT_1080P30])
  })

  it('shouldSendTheNextQuestionAfterTheTurnLimitAndNoEarlierWhenTheCurrentOneNeverSettles', async () => {
    const browser = browserAnsweringByHand()
    const { ask } = createDecodingAnswers({ decodingInfo: browser.decodingInfo })
    void ask(HEVC_AT_2160P60)
    void ask(H264_AT_1080P30)

    await letTurnsPass(249)
    expect(askedConfigurations(browser.decodingInfo)).toEqual([HEVC_AT_2160P60])

    await letTurnsPass(1)
    expect(askedConfigurations(browser.decodingInfo)).toEqual([HEVC_AT_2160P60, H264_AT_1080P30])
  })

  it('shouldSendAQuestionOnceWhenTwoAsksShareItWhileItWaitsInLine', async () => {
    const browser = browserAnsweringByHand()
    const { ask } = createDecodingAnswers({ decodingInfo: browser.decodingInfo })
    void ask(H264_AT_1080P30)
    const first = ask(HEVC_AT_2160P60)
    const second = ask(HEVC_AT_2160P60)
    await letTurnsPass(0)

    browser.sent[0].resolve(SUPPORTED)
    await letTurnsPass(0)
    browser.sent[1].resolve(SUPPORTED)

    await expect(first).resolves.toEqual(SUPPORTED)
    await expect(second).resolves.toEqual(SUPPORTED)
    expect(askedConfigurations(browser.decodingInfo)).toEqual([H264_AT_1080P30, HEVC_AT_2160P60])
  })

  it('shouldSendAQuestionOnceWhenAnotherAskOfItComesWithinItsTurn', async () => {
    const browser = browserAnsweringByHand()
    const { ask } = createDecodingAnswers({ decodingInfo: browser.decodingInfo })
    const first = ask(HEVC_AT_2160P60)
    await letTurnsPass(249)

    const second = ask(HEVC_AT_2160P60)
    browser.sent[0].resolve(SUPPORTED)

    await expect(first).resolves.toEqual(SUPPORTED)
    await expect(second).resolves.toEqual(SUPPORTED)
    expect(browser.decodingInfo).toHaveBeenCalledOnce()
  })

  it('shouldSendTheQuestionAgainWhenItsTurnPassedWithoutAnAnswer', async () => {
    const browser = browserAnsweringByHand()
    const { ask } = createDecodingAnswers({ decodingInfo: browser.decodingInfo })
    void ask(HEVC_AT_2160P60)
    await letTurnsPass(250)

    void ask(HEVC_AT_2160P60)
    await letTurnsPass(0)

    expect(askedConfigurations(browser.decodingInfo)).toEqual([HEVC_AT_2160P60, HEVC_AT_2160P60])
  })

  it('shouldKeepALateAnswerAndAnswerALaterAskFromItWithoutTheBrowser', async () => {
    const browser = browserAnsweringByHand()
    const { ask } = createDecodingAnswers({ decodingInfo: browser.decodingInfo })
    const first = ask(HEVC_AT_2160P60)
    await letTurnsPass(250)

    browser.sent[0].resolve(SUPPORTED)
    await expect(first).resolves.toEqual(SUPPORTED)
    const later = ask(HEVC_AT_2160P60)

    await expect(later).resolves.toEqual(SUPPORTED)
    expect(browser.decodingInfo).toHaveBeenCalledOnce()
  })

  it('shouldSettleAnAskThatWaitsInLineWithALateAnswerAndNeverSendItsQuestionAgain', async () => {
    const browser = browserAnsweringByHand()
    const { ask } = createDecodingAnswers({ decodingInfo: browser.decodingInfo })
    void ask(HEVC_AT_2160P60)
    await letTurnsPass(250)
    void ask(H264_AT_1080P30)
    const waiting = ask(HEVC_AT_2160P60)
    await letTurnsPass(0)

    browser.sent[0].resolve(SUPPORTED)
    await expect(waiting).resolves.toEqual(SUPPORTED)
    browser.sent[1].resolve(SUPPORTED)
    await letTurnsPass(0)

    expect(askedConfigurations(browser.decodingInfo)).toEqual([HEVC_AT_2160P60, H264_AT_1080P30])
  })

  it('shouldSettleTheQuestionSentAgainWithTheFirstAnswerThatArrives', async () => {
    const browser = browserAnsweringByHand()
    const { ask } = createDecodingAnswers({ decodingInfo: browser.decodingInfo })
    const first = ask(HEVC_AT_2160P60)
    await letTurnsPass(250)
    const sentAgain = ask(HEVC_AT_2160P60)
    await letTurnsPass(0)

    browser.sent[0].resolve(SUPPORTED)

    await expect(first).resolves.toEqual(SUPPORTED)
    await expect(sentAgain).resolves.toEqual(SUPPORTED)
  })

  it('shouldSettleTheAskWithTheRefusalAndAskTheBrowserAgainWhenTheRefusalArrivesAfterItsTurn', async () => {
    const browser = browserAnsweringByHand()
    const { ask } = createDecodingAnswers({ decodingInfo: browser.decodingInfo })
    const first = ask(HEVC_AT_2160P60)
    await letTurnsPass(250)

    browser.sent[0].resolve(REFUSED)

    await expect(first).resolves.toEqual(REFUSED)
    void ask(HEVC_AT_2160P60)
    await letTurnsPass(0)
    expect(askedConfigurations(browser.decodingInfo)).toEqual([HEVC_AT_2160P60, HEVC_AT_2160P60])
  })

  it('shouldSettleTheQuestionSentAgainWithItsOwnAnswerWhenTheFirstSendingIsRefusedLate', async () => {
    const browser = browserAnsweringByHand()
    const { ask } = createDecodingAnswers({ decodingInfo: browser.decodingInfo })
    const first = ask(HEVC_AT_2160P60)
    await letTurnsPass(250)
    const sentAgain = ask(HEVC_AT_2160P60)
    await letTurnsPass(0)

    browser.sent[0].resolve(REFUSED)
    browser.sent[1].resolve(SUPPORTED)

    await expect(first).resolves.toEqual(REFUSED)
    await expect(sentAgain).resolves.toEqual(SUPPORTED)
  })

  it('shouldShareTheQuestionSentAgainWhenTheFirstSendingRejectsLate', async () => {
    const browser = browserAnsweringByHand()
    const { ask } = createDecodingAnswers({ decodingInfo: browser.decodingInfo })
    const first = ask(HEVC_AT_2160P60).catch(() => 'rejected')
    await letTurnsPass(250)
    const sentAgain = ask(HEVC_AT_2160P60)
    await letTurnsPass(0)
    browser.sent[0].reject(new TypeError('Unsupported configuration'))
    await expect(first).resolves.toBe('rejected')

    const sharing = ask(HEVC_AT_2160P60)
    await letTurnsPass(250)
    browser.sent[1].resolve(SUPPORTED)

    await expect(sentAgain).resolves.toEqual(SUPPORTED)
    await expect(sharing).resolves.toEqual(SUPPORTED)
    expect(browser.decodingInfo).toHaveBeenCalledTimes(2)
  })
})

describe('browserDecodingAnswers', () => {
  it.each([
    ['SafariOnAMac', SAFARI_ON_A_MAC, 'MacIntel'],
    ['SafariOnTheIphone', IPHONE_SAFARI_USER_AGENT, 'iPhone'],
    ['ChromeOnTheIphone', CHROME_ON_THE_IPHONE, 'iPhone'],
  ])(
    'shouldAskTheBrowserOnceForARepeatedQuestionWhen%sOpensThePage',
    async (_, userAgent, platform) => {
      const decodingInfo = vi.fn<DecodingInfo>(() => Promise.resolve(SUPPORTED))
      browseIn({ userAgent, platform, decodingInfo })
      const answers = browserDecodingAnswers()

      const asked = [await answers?.ask(HEVC_AT_2160P60), await answers?.ask(HEVC_AT_2160P60)]

      expect(asked).toEqual([SUPPORTED, SUPPORTED])
      expect(decodingInfo).toHaveBeenCalledOnce()
    },
  )

  it.each([
    ['Chromium', CHROME_USER_AGENT, 'MacIntel'],
    ['Firefox', FIREFOX, 'MacIntel'],
    ['WebKitOnLinux', SAFARI_ON_A_MAC, 'Linux x86_64'],
    ['WebKitOnWindows', SAFARI_ON_A_MAC, 'Win32'],
  ])('shouldKeepNoAnswersWhen%sOpensThePage', (_, userAgent, platform) => {
    browseIn({ userAgent, platform, decodingInfo: vi.fn<DecodingInfo>() })

    expect(browserDecodingAnswers()).toBeUndefined()
  })

  it('shouldKeepNoAnswersWhenSafariOffersNoMediaCapabilities', () => {
    browseIn({ userAgent: SAFARI_ON_A_MAC, platform: 'MacIntel' })

    expect(browserDecodingAnswers()).toBeUndefined()
  })
})
