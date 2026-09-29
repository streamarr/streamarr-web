export interface FakeAudioTrack {
  label: string
  language: string
  enabled: boolean
}

export interface FakeTextTrack {
  kind: TextTrackKind
  label: string
  language: string
  mode: TextTrackMode
}

/** A media element's track list as a browser builds one: indexed tracks on an event target. */
export function fakeTrackList<Track extends object>(
  tracks: Track[],
): EventTarget & ArrayLike<Track> {
  return Object.assign(new EventTarget(), tracks, { length: tracks.length })
}

/** Gives the element the track lists a browser that plays HLS itself would. */
export function giveElementTracks(
  video: HTMLVideoElement,
  { audio = [], text = [] }: { audio?: FakeAudioTrack[]; text?: FakeTextTrack[] },
): { audioTracks: EventTarget; textTracks: EventTarget } {
  const audioTracks = fakeTrackList(audio)
  const textTracks = fakeTrackList(text)
  Object.defineProperty(video, 'audioTracks', { configurable: true, value: audioTracks })
  Object.defineProperty(video, 'textTracks', { configurable: true, value: textTracks })
  return { audioTracks, textTracks }
}
