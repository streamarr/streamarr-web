import { describe, expect, it } from 'vitest'
import type { PlaybackDelivery, VideoRange } from '../graphql/generated/graphql'
import { AAC_STEREO, H264_FULL_HD } from '../test/playbackSession'
import { audioFormatText, deliveryText, videoFormatText } from './playbackDecisionText'

describe('playbackDecisionText', () => {
  it('shouldNameADeliveryThisAppDoesNotKnowWhenTheServerAddsOne', () => {
    expect(deliveryText('A_DELIVERY_ADDED_LATER' as PlaybackDelivery)).toBe('Another delivery')
  })

  it('shouldShowARangeThisAppDoesNotKnowAsTheServerNamesIt', () => {
    const format = { ...H264_FULL_HD, videoRange: 'A_RANGE_ADDED_LATER' as VideoRange }

    expect(videoFormatText(format)).toBe(
      'H.264 · 1920×1080 · 23.976 fps · A_RANGE_ADDED_LATER · 8 Mb/s',
    )
  })

  it('shouldShowACodecThisAppHasNoNameForAsTheServerNamesIt', () => {
    expect(audioFormatText({ ...AAC_STEREO, codec: 'pcm_s24le' })).toBe(
      'pcm_s24le · 2 channels · 192 kb/s',
    )
  })

  it('shouldNameOneChannelInTheSingularWhenTheAudioIsMono', () => {
    expect(audioFormatText({ codec: 'aac', channels: 1, bitrate: null })).toBe('AAC · 1 channel')
  })
})
