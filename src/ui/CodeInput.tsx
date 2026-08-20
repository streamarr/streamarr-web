import { useId, useState, type ClipboardEvent } from 'react'
import './auth.css'

// One-character-per-box code entry (components.yaml CodeInput; frames 13/15a): link-TV codes
// and PIN pads are the same component. A real input rides invisibly over the boxes so focus,
// paste, and assistive tech work on a genuine field; the boxes are its rendering.
export function CodeInput({
  label,
  value,
  onChange,
  length,
  minLength,
  groupSize,
  secret = false,
  alphanumeric = false,
  error = false,
  settled = false,
  autoFocus = false,
  testId,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  /** Fixed code length (link-TV). Omit for variable-length secrets and set minLength. */
  length?: number
  /** Variable-length floor (PINs are 4-8 digits): boxes grow past it as digits arrive. */
  minLength?: number
  /** Draws the mock's dash separator after every N boxes (link-TV: 4). */
  groupSize?: number
  secret?: boolean
  alphanumeric?: boolean
  error?: boolean
  /** Frame 13b: an accepted code stays visible but recedes. */
  settled?: boolean
  autoFocus?: boolean
  testId?: string
}) {
  const id = useId()
  const [focused, setFocused] = useState(false)
  const max = length ?? 8
  // Four at rest and one box per typed digit past that: a fully typed four-digit PIN is four
  // filled boxes — growing a fifth on completion implied it wasn't done — and the count still
  // never leaks a longer PIN's length before its digits arrive.
  const shown = length ?? Math.max(minLength ?? 4, Math.min(value.length, max))
  const clean = (raw: string) =>
    (alphanumeric ? raw.replaceAll(/[^a-zA-Z0-9]/g, '') : raw.replaceAll(/\D/g, ''))
      .toUpperCase()
      .slice(0, max)

  const cells = Array.from({ length: shown }, (_, index) => {
    const filled = index < value.length
    // The cursor marks where the next digit lands, and only while a visible box awaits one.
    const active =
      focused && !settled && value.length < max && index === value.length && index < shown
    return (
      <div
        key={index}
        className={`codeInputCell${active ? ' codeInputCellActive' : ''}`}
        aria-hidden
      >
        {active && !filled ? '|' : filled ? (secret ? '•' : value[index]) : ' '}
      </div>
    )
  })

  const withSeparators = groupSize
    ? cells.flatMap((cell, index) =>
        index > 0 && index % groupSize === 0
          ? [<div key={`sep-${index}`} className="codeInputSeparator" aria-hidden />, cell]
          : [cell],
      )
    : cells

  return (
    <div
      className={`codeInput${error ? ' codeInputError' : ''}${settled ? ' codeInputSettled' : ''}`}
    >
      {withSeparators}
      <input
        id={id}
        className="codeInputField"
        aria-label={label}
        aria-invalid={error || undefined}
        inputMode={alphanumeric ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        disabled={settled}
        value={secret ? '•'.repeat(value.length) : value}
        data-testid={testId}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          // Secret mode renders masked text into the field; reconstruct from the tail so
          // ordinary typing and deletions both land on the real value.
          const raw = event.currentTarget.value
          if (!secret) {
            onChange(clean(raw))
            return
          }
          const masked = '•'.repeat(value.length)
          if (raw.length < masked.length) {
            onChange(value.slice(0, raw.length))
            return
          }
          onChange(clean(value + raw.slice(masked.length)))
        }}
        onPaste={(event: ClipboardEvent<HTMLInputElement>) => {
          event.preventDefault()
          onChange(clean(event.clipboardData.getData('text')))
        }}
      />
    </div>
  )
}
