import './auth.css'

// A profile of the context Household as the picker shows it (frame 15): a 120px rounded
// square of initials, the lock badge riding the corner when a PIN stands between the person
// and the profile, and the Kids mark as a system-voice label. The glyph carries the state —
// no helper prose (principles 6 and 8.2).
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
  /** Selecting detours through the PIN gate; the lock glyph marks the door, not a wall. */
  pinProtected?: boolean
  /** The Household safety rule: visible, not selectable, until a PIN is set. */
  locked?: boolean
  paletteIndex?: number
  busy?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className="profileTile"
      disabled={locked || busy}
      aria-label={locked ? `${name} (locked)` : pinProtected ? `${name} (PIN protected)` : name}
      onClick={onSelect}
    >
      <span className="profileTileAvatar" style={{ background: tileColor(paletteIndex) }}>
        {initials(name)}
        {(locked || pinProtected) && (
          <span className="profileTileLock">
            <LockGlyph />
          </span>
        )}
      </span>
      <span className="profileTileName">{name}</span>
      {kid && <span className="profileTileKind">Kids</span>}
    </button>
  )
}

export function PinGateAvatar({ name, paletteIndex = 0 }: { name: string; paletteIndex?: number }) {
  return (
    <span className="pinGateAvatar" style={{ background: tileColor(paletteIndex) }}>
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

// Solid fills drawn from the token layer (principle 2.5): deep blue is selection.active's own
// value; the deep purple and mint are the brand and semantic hues grounded toward black, the
// same derivation the mock tiles use. Cycled by position, so a Household's tiles differ.
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
