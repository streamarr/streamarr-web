import type { SubtitleMode } from '../graphql/generated/graphql'

/** The subtitle modes a viewer can choose, in the order screens offer them. */
export const SUBTITLE_MODES = [
  { value: 'OFF', label: 'Off', description: 'No subtitles, not even forced ones.' },
  {
    value: 'FORCED',
    label: 'Forced only',
    description: 'Only forced subtitles, which translate lines in another language than the audio.',
  },
  {
    value: 'ALWAYS',
    label: 'Always',
    description: 'Subtitles in the subtitle language, whatever the audio.',
  },
] as const satisfies readonly { value: SubtitleMode; label: string; description: string }[]
