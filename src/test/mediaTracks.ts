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

/**
 * Adds tracks to an element's audio track list, as a browser does once it reads them from a file:
 * at the end, or before the track at `at`, since a browser keeps the list in the file's order.
 */
export function listAudioTracks(
  list: EventTarget,
  tracks: FakeAudioTrack[],
  { at }: { at?: number } = {},
) {
  const listed = Array.from(list as unknown as ArrayLike<FakeAudioTrack>)
  listed.splice(at ?? listed.length, 0, ...tracks)
  tracks.forEach((track) => announceSwitches(track, list))
  Object.assign(list, listed, { length: listed.length })
  list.dispatchEvent(new Event('addtrack'))
}
