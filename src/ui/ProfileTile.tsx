import styles from './ProfileTile.module.css'

export function ProfileTile({
  name,
  kid = false,
  pinProtected = false,
  locked = false,
  paletteIndex = 0,
  busy = false,
  onSelect,
}: {
  name: string
  kid?: boolean
  /** Selecting detours through the PIN gate. */
  pinProtected?: boolean
  /** Visible, not selectable, until a PIN is set. */
  locked?: boolean
  paletteIndex?: number
  busy?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={styles.profileTile}
      disabled={locked || busy}
      aria-label={tileLabel(name, locked, pinProtected)}
      onClick={onSelect}
    >
      <span className={styles.profileTileAvatar} style={{ background: tileColor(paletteIndex) }}>
        {initials(name)}
        {(locked || pinProtected) && (
          <span className={styles.profileTileLock}>
            <LockGlyph />
          </span>
        )}
      </span>
      <span className={styles.profileTileName}>{name}</span>
      {kid && <span className={styles.profileTileKind}>Kids</span>}
    </button>
  )
}

function tileLabel(name: string, locked: boolean, pinProtected: boolean) {
  if (locked) return `${name} (locked)`
  if (pinProtected) return `${name} (PIN protected)`
  return name
}

export function PinGateAvatar({ name, paletteIndex = 0 }: { name: string; paletteIndex?: number }) {
  return (
    <span className={styles.pinGateAvatar} style={{ background: tileColor(paletteIndex) }}>
      {initials(name)}
    </span>
  )
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : (parts[0]?.[1] ?? '')
  return (first + last).toUpperCase()
}

// Token-layer hues grounded toward black, cycled by position so a Household's tiles differ.
const TILE_COLORS = [
  'var(--color-blue-deep)',
  'color-mix(in srgb, var(--color-brand-purple) 45%, #060608)',
  'color-mix(in srgb, var(--color-mint) 30%, #060608)',
  'color-mix(in srgb, var(--color-brand-blue) 45%, #060608)',
]

export function tileColor(index: number) {
  return TILE_COLORS[((index % TILE_COLORS.length) + TILE_COLORS.length) % TILE_COLORS.length]
}

function LockGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fff"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}
