# 7.1 channel order

`seven-one-channel-order.spec.ts` plays a synthetic 7.1 stream through hls.js on Media Source
Extensions, with the player's hls.js settings, and reads each decoded channel through a
`ChannelSplitterNode` with one `AnalyserNode` per output. After 1 s of silence, each channel in
FFmpeg's 7.1 order carries a tone for 1 s while the others are silent: front left, front right,
centre, LFE, back left, back right, side left, side right. 2 s of silence end the stream. The LFE
tone is 50 Hz; the others are 1 kHz. The spec writes the stream with FFmpeg when it starts: AAC at
768 kb/s, FLAC, and Opus at 768 kb/s with `-mapping_family 1`.

The tones must reach outputs 1 to 8 in turn, each at least 20 dB above every other output. The spec
identifies each tone by the order it arrives in, not by the element's time: WebKit on Linux runs its
audio graph up to a second behind the element.

| Result | Meaning |
| --- | --- |
| `passed` | Every tone reached its own output, in order, 20 dB above the others. The decoder hands all 8 channels to the audio graph in order. |
| `failed` | The tones reached the outputs in another order, fewer than 8 outputs heard a tone, or a tone was less than 20 dB above another output. |
| `not observed` | Every output read silence ([WebKit bug 266922](https://bugs.webkit.org/show_bug.cgi?id=266922)). |
| `did not play` | The stream did not play to its end. |

Only `passed` lets a browser declare 8 channels for that codec, and only when `decodingInfo()` also
confirms 8 channels (streamarr/streamarr-web#29). Every other result keeps the 6-channel cap. The
result shows the order in which the decoder hands channels to the audio graph. It does not show how
the operating system maps the device's channels to speakers.

## Results

The spec fails when its result differs from the last row for the same browser, platform and codec.
Add a row when a result changes, and keep the old rows: the declaration keys an 8-channel entry on
the oldest version that passed.

The macOS rows come from macOS 26.6 on Apple silicon. The Linux rows come from the CI runner. There,
Firefox runs its audio graph only when an audio server runs, so CI starts PulseAudio with a null sink
for Firefox. WebKit stalls Opus streams while PulseAudio runs, so WebKit runs without it.

| Browser | Version | Platform | Codec | Result | Note |
| --- | --- | --- | --- | --- | --- |
| chromium | 156.0.8078.4 | macOS | AAC | passed | |
| chromium | 156.0.8078.4 | macOS | FLAC | passed | |
| chromium | 156.0.8078.4 | macOS | OPUS | passed | |
| chrome | 156.0.8078.80 | macOS | AAC | passed | |
| chrome | 156.0.8078.80 | macOS | FLAC | passed | |
| chrome | 156.0.8078.80 | macOS | OPUS | passed | |
| firefox | 157.0 | macOS | AAC | failed | AAC's own order: centre, front left, front right, side left, side right, back left, back right, LFE. |
| firefox | 157.0 | macOS | FLAC | passed | |
| firefox | 157.0 | macOS | OPUS | passed | |
| webkit | 27.2 | macOS | AAC | not observed | |
| webkit | 27.2 | macOS | FLAC | not observed | |
| webkit | 27.2 | macOS | OPUS | did not play | The audio SourceBuffer rejects the first append. |
| chromium | 156.0.8078.4 | Linux | AAC | passed | |
| chromium | 156.0.8078.4 | Linux | FLAC | passed | |
| chromium | 156.0.8078.4 | Linux | OPUS | passed | |
| chrome | 156.0.8078.47 | Linux | AAC | passed | |
| chrome | 156.0.8078.47 | Linux | FLAC | passed | |
| chrome | 156.0.8078.47 | Linux | OPUS | passed | |
| firefox | 157.0 | Linux | AAC | passed | |
| firefox | 157.0 | Linux | FLAC | passed | |
| firefox | 157.0 | Linux | OPUS | passed | |
| webkit | 27.2 | Linux | AAC | passed | |
| webkit | 27.2 | Linux | FLAC | failed | Front left, front right, back left, back right, centre, LFE, side left, side right. |
| webkit | 27.2 | Linux | OPUS | passed | |
