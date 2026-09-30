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

// A media element's track list as a browser builds one: indexed tracks on an event target, which
// announces a change whenever a track is switched on or off.
function fakeTrackList<Track extends object>(tracks: Track[]): EventTarget & ArrayLike<Track> {
  const list = new EventTarget()
  for (const track of tracks) {
    announceSwitches(track, list)
  }
  return Object.assign(list, tracks, { length: tracks.length })
}

function announceSwitches(track: object, list: EventTarget) {
  for (const switchKey of ['enabled', 'mode'].filter((key) => key in track)) {
    let value: unknown = Reflect.get(track, switchKey)
    Object.defineProperty(track, switchKey, {
      get: () => value,
      set: (next: unknown) => {
        value = next
        list.dispatchEvent(new Event('change'))
      },
    })
  }
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
