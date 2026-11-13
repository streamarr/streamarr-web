import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { usePlaybackFallbacks } from './usePlaybackFallbacks'

describe('usePlaybackFallbacks', () => {
  it('shouldRaiseNoAudioCautionWhenTheRefusalArrivesAfterThePickOfThePlayingTrack', () => {
    const viewing = {}
    const { result } = renderHook(() => usePlaybackFallbacks(viewing))
    act(() => result.current.pickAudio({ playing: false }))
    act(() => result.current.pickAudio({ playing: true }))

    act(() => result.current.refuseAudioSwitch())

    expect(result.current.cautions.audio).toBeUndefined()
    expect(result.current.announcement).toBeNull()
  })
})
