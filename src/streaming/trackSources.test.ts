import Hls from 'hls.js'
import { describe, expect, it, vi } from 'vitest'
import { giveElementTracks } from '../test/mediaTracks'
import { type HlsTracks, NO_TRACKS, hlsTrackSource, nativeTrackSource } from './trackSources'

const HLS_TRACK_EVENTS = [
  Hls.Events.AUDIO_TRACKS_UPDATED,
  Hls.Events.AUDIO_TRACK_SWITCHING,
  Hls.Events.SUBTITLE_TRACKS_UPDATED,
  Hls.Events.SUBTITLE_TRACK_SWITCH,
]

type FakeHls = HlsTracks & { emit: (event: string) => void }

function fakeHls(
  tracks: Partial<
    Pick<HlsTracks, 'audioTracks' | 'audioTrack' | 'subtitleTracks' | 'subtitleTrack'>
  >,
): FakeHls {
  const listeners = new Map<string, Set<() => void>>()
  return {
    audioTracks: [],
    audioTrack: -1,
    subtitleTracks: [],
    subtitleTrack: -1,
    ...tracks,
    on: (event, listener) => {
      listeners.set(event, (listeners.get(event) ?? new Set()).add(listener))
    },
    off: (event, listener) => {
      listeners.get(event)?.delete(listener)
    },
    emit: (event) => listeners.get(event)?.forEach((listener) => listener()),
  }
}

describe('hlsTrackSource', () => {
  it('shouldListTheStreamsAudioAndSubtitleTracksByName', () => {
    const source = hlsTrackSource(
      fakeHls({
        audioTracks: [
          { name: 'English', lang: 'en' },
          { name: 'Commentary', lang: 'en' },
        ],
        audioTrack: 1,
        subtitleTracks: [{ name: 'English (SDH)', lang: 'en' }],
      }),
    )

    expect(source.read()).toEqual({
      audio: {
        options: [
          { id: 0, label: 'English' },
          { id: 1, label: 'Commentary' },
        ],
        selected: 1,
      },
      subtitles: { options: [{ id: 0, label: 'English (SDH)' }], selected: null },
    })
  })

  it('shouldNameAnUnnamedTrackByItsLanguageThenByItsPlace', () => {
    const source = hlsTrackSource(
      fakeHls({
        audioTracks: [{ name: '', lang: 'fr' }, { name: '' }, { name: '', lang: 'not a language' }],
      }),
    )

    expect(source.read().audio.options.map((option) => option.label)).toEqual([
      'French',
      'Track 2',
      'Track 3',
    ])
  })

  it('shouldReadTheSameTracksUntilTheyChange', () => {
    const hls = fakeHls({ audioTracks: [{ name: 'English' }, { name: 'Deutsch' }], audioTrack: 0 })
    const source = hlsTrackSource(hls)
    const first = source.read()

    expect(source.read()).toBe(first)
    hls.audioTrack = 1
    expect(source.read()).not.toBe(first)
    expect(source.read().audio.selected).toBe(1)
  })

  it('shouldAnnounceEachTrackChangeUntilUnsubscribed', () => {
    const hls = fakeHls({})
    const onChange = vi.fn()
    const unsubscribe = hlsTrackSource(hls).subscribe(onChange)

    HLS_TRACK_EVENTS.forEach((event) => hls.emit(event))
    expect(onChange).toHaveBeenCalledTimes(HLS_TRACK_EVENTS.length)

    unsubscribe()
    HLS_TRACK_EVENTS.forEach((event) => hls.emit(event))
    expect(onChange).toHaveBeenCalledTimes(HLS_TRACK_EVENTS.length)
  })
})

describe('nativeTrackSource', () => {
  it('shouldListTheElementsAudioTracksAndItsSubtitleAndCaptionTracks', () => {
    const video = document.createElement('video')
    giveElementTracks(video, {
      audio: [
        { label: 'English', language: 'en', enabled: false },
        { label: '', language: 'de', enabled: true },
      ],
      text: [
        { kind: 'subtitles', label: 'English', language: 'en', mode: 'disabled' },
        { kind: 'metadata', label: '', language: '', mode: 'hidden' },
        { kind: 'captions', label: 'English (SDH)', language: 'en', mode: 'showing' },
      ],
    })

    expect(nativeTrackSource(video).read()).toEqual({
      audio: {
        options: [
          { id: 0, label: 'English' },
          { id: 1, label: 'German' },
        ],
        selected: 1,
      },
      subtitles: {
        options: [
          { id: 0, label: 'English' },
          { id: 1, label: 'English (SDH)' },
        ],
        selected: 1,
      },
    })
  })

  it('shouldReadNoTracksFromAnElementWithoutTrackLists', () => {
    const video = document.createElement('video')
    Object.defineProperty(video, 'audioTracks', { configurable: true, value: undefined })
    const source = nativeTrackSource(video)

    const unsubscribe = source.subscribe(vi.fn())

    expect(source.read()).toEqual(NO_TRACKS)
    unsubscribe()
  })

  it('shouldAnnounceAddedRemovedAndChangedTracksUntilUnsubscribed', () => {
    const video = document.createElement('video')
    const lists = giveElementTracks(video, {})
    const onChange = vi.fn()
    const unsubscribe = nativeTrackSource(video).subscribe(onChange)
    const announceEveryChange = () => {
      for (const list of [lists.audioTracks, lists.textTracks]) {
        for (const type of ['addtrack', 'removetrack', 'change']) {
          list.dispatchEvent(new Event(type))
        }
      }
    }

    announceEveryChange()
    expect(onChange).toHaveBeenCalledTimes(6)

    unsubscribe()
    announceEveryChange()
    expect(onChange).toHaveBeenCalledTimes(6)
  })
})
