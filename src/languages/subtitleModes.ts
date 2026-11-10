import type { SubtitleMode } from '../graphql/generated/graphql'

/** The subtitle modes a viewer can choose, in the order screens offer them. */
export const SUBTITLE_MODES = [
  { value: 'OFF', label: 'Off', description: 'No subtitles by default.' },
  {
    value: 'FORCED',
    label: 'Forced only',
    description: 'Subtitles only appear when language differs from audio language.',
  },
  {
    value: 'ALWAYS',
    label: 'Always',
    description: 'Subtitles are on by default.',
  },
] as const satisfies readonly { value: SubtitleMode; label: string; description: string }[]
