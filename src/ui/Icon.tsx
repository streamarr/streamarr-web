import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clapperboard,
  Eye,
  EyeOff,
  Folder,
  LockKeyhole,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  ScanLine,
  Settings,
  TriangleAlert,
  TvMinimal,
  X,
} from 'lucide-react'

// Import only the approved glyphs; never bundle Lucide's dynamic icon registry. The package's
// license notice ships beside the fonts' as public/lucide-ISC.txt.
const icons = {
  movie: Clapperboard,
  series: TvMinimal,
  folder: Folder,
  plus: Plus,
  'arrow-right': ArrowRight,
  'arrow-left': ArrowLeft,
  'chevron-right': ChevronRight,
  'chevron-left': ChevronLeft,
  'chevron-down': ChevronDown,
  check: Check,
  'watched-action': CircleCheck,
  play: Play,
  lock: LockKeyhole,
  'sign-out': LogOut,
  'show-password': Eye,
  'hide-password': EyeOff,
  alert: TriangleAlert,
  scan: ScanLine,
  refresh: RefreshCw,
  settings: Settings,
  close: X,
} as const

/** Approved semantic names from streamarr-ux's ICONOGRAPHY.md. */
export type IconName = keyof typeof icons

/** Shared icon geometry; colors come from the surrounding control's currentColor. */
export interface IconProps {
  /** Meaning, not an arbitrary upstream icon name. The same meaning shares one glyph. */
  name: IconName
  /** Square CSS-pixel size: 20 for controls, 14/16 for compact marks, 32/40 for empty states. */
  size?: 14 | 16 | 20 | 24 | 32 | 40
  /** Optional standalone image label. Omit when adjacent text or the parent control names it. */
  label?: string
  /** Layout/color styling only; do not override geometry, stroke, or apply transforms. */
  className?: string
}

/** A Lucide glyph in the approved geometry: decorative unless `label` makes it an image. */
export function Icon({ name, size = 20, label, className }: Readonly<IconProps>) {
  const Glyph = icons[name]
  return (
    <Glyph
      size={size}
      strokeWidth={1.75}
      nonScalingStroke
      fill={name === 'play' ? 'currentColor' : 'none'}
      className={className}
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  )
}
