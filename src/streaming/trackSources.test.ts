import Hls from 'hls.js'
import { describe, expect, it, vi } from 'vitest'
import { type FakeAudioTrack, type FakeTextTrack, giveElementTracks } from '../test/mediaTracks'
import {
  type HlsTracks,
  NO_TRACKS,
  hlsTrackSource,
  listedAudioTrackSource,
  nativeTrackSource,
} from './trackSources'

const HLS_TRACK_EVENTS = [
  Hls.Events.AUDIO_TRACKS_UPDATED,
  Hls.Events.AUDIO_TRACK_SWITCHING,
  Hls.Events.SUBTITLE_TRACKS_UPDATED,
  Hls.Events.SUBTITLE_TRACK_SWITCH,
]

type FakeHls = HlsTracks & { emit: (event: string) => void }

// As hls.js parses an EXT-X-MEDIA tag: a rendition without a NAME takes its LANGUAGE as its name.
function parsedRendition({ NAME, LANGUAGE }: { NAME?: string; LANGUAGE?: string }) {
  return { name: NAME || LANGUAGE || '', lang: LANGUAGE }
}

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
          { id: 0, label: 'English', language: 'en' },
          { id: 1, label: 'Commentary', language: 'en' },
        ],
        selected: 1,
      },
      subtitles: {
        options: [{ id: 0, label: 'English (SDH)', language: 'en' }],
        selected: null,
      },
    })
  })

  it('shouldNameAnUnnamedTrackByItsLanguageThenByItsPlace', () => {
    const source = hlsTrackSource(
      fakeHls({
        audioTracks: [
          parsedRendition({ LANGUAGE: 'fr' }),
          parsedRendition({}),
          parsedRendition({ LANGUAGE: 'not a language' }),
        ],
      }),
    )

    expect(source.read().audio.options.map((option) => option.label)).toEqual([
      'French',
      'Track 2',
      'Track 3',
    ])
    expect(source.read().audio.options.map((option) => option.language)).toEqual([
      'fr',
      undefined,
      'not a language',
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

  it('shouldSwitchTheStreamsTracksThroughHls', () => {
    const hls = fakeHls({
      audioTracks: [{ name: 'English' }, { name: 'Deutsch' }],
      audioTrack: 0,
      subtitleTracks: [{ name: 'English' }],
    })
    const source = hlsTrackSource(hls)

    source.selectAudio(1)
    source.selectSubtitles(0)
    expect([hls.audioTrack, hls.subtitleTrack]).toEqual([1, 0])

    source.selectSubtitles(null)
    expect(hls.subtitleTrack).toBe(-1)
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
          { id: 0, label: 'English', language: 'en' },
          { id: 1, label: 'German', language: 'de' },
        ],
        selected: 1,
      },
      subtitles: {
        options: [
          { id: 0, label: 'English', language: 'en' },
          { id: 1, label: 'English (SDH)', language: 'en' },
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

  it('shouldSwitchTheElementsOwnTracks', () => {
    const video = document.createElement('video')
    const audio: FakeAudioTrack[] = [
      { label: 'English', language: 'en', enabled: true },
      { label: 'Commentary', language: 'en', enabled: false },
    ]
    const text: FakeTextTrack[] = [
      { kind: 'subtitles', label: 'English', language: 'en', mode: 'showing' },
      { kind: 'metadata', label: '', language: '', mode: 'hidden' },
      { kind: 'captions', label: 'English (SDH)', language: 'en', mode: 'disabled' },
    ]
    giveElementTracks(video, { audio, text })
    const source = nativeTrackSource(video)

    source.selectAudio(1)
    source.selectSubtitles(1)
    expect(audio.map((track) => track.enabled)).toEqual([false, true])
    expect(text.map((track) => track.mode)).toEqual(['disabled', 'hidden', 'showing'])

    source.selectSubtitles(null)
    expect(text.map((track) => track.mode)).toEqual(['disabled', 'hidden', 'disabled'])
  })
})

describe('listedAudioTrackSource', () => {
  it('shouldNameEachListedTrackByItsTitleThenItsLanguageThenItsPlace', () => {
    const video = document.createElement('video')
    const source = listedAudioTrackSource(nativeTrackSource(video), {
      audioTracks: [
        { position: 0, language: 'eng', title: 'Commentary' },
        { position: 1, language: 'fre', title: null },
        { position: 2, language: 'und', title: null },
        { position: 3, language: null, title: null },
      ],
      playing: 1,
      onChooseAudio: () => undefined,
    })

    const { options, selected } = source.read().audio
    expect(options.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 0, label: 'Commentary' },
      { id: 1, label: 'French' },
      { id: 2, label: 'Track 3' },
      { id: 3, label: 'Track 4' },
    ])
    expect(selected).toBe(1)
  })

  it('shouldTagEachListedTrackWithTheLanguageTheFileGivesIt', () => {
    const source = listedAudioTrackSource(nativeTrackSource(document.createElement('video')), {
      audioTracks: [
        { position: 0, language: 'fre', title: 'Commentaire' },
        { position: 1, language: null, title: null },
      ],
      playing: 0,
      onChooseAudio: () => undefined,
    })

    expect(source.read().audio.options.map((option) => option.language)).toEqual(['fre', undefined])
  })

  it('shouldHandOnlyAnotherTrackToTheSwitchWhenTheViewerChoosesOne', () => {
    const chosen: number[] = []
    const source = listedAudioTrackSource(nativeTrackSource(document.createElement('video')), {
      audioTracks: [
        { position: 0, language: 'eng' },
        { position: 1, language: 'fre' },
      ],
      playing: 0,
      onChooseAudio: (position) => chosen.push(position),
    })

    source.selectAudio(0)
    source.selectAudio(1)

    expect(chosen).toEqual([1])
  })
})
