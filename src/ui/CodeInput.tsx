import { useId, useState, type ClipboardEvent } from 'react'
import styles from './CodeInput.module.css'

// A real input rides invisibly over the boxes so focus, paste, and assistive tech work on a
// genuine field; the boxes are its rendering.
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
}: Readonly<{
  label: string
  value: string
  onChange: (next: string) => void
  /** Fixed code length. Omit for variable-length secrets and set minLength. */
  length?: number
  /** Variable-length floor: boxes grow past it as digits arrive. */
  minLength?: number
  /** Draws a separator after every N boxes. */
  groupSize?: number
  secret?: boolean
  alphanumeric?: boolean
  error?: boolean
  /** An accepted code stays visible but recedes. */
  settled?: boolean
  autoFocus?: boolean
  testId?: string
}>) {
  const id = useId()
  const [focused, setFocused] = useState(false)
  const max = length ?? 8
  // A PIN typed to the floor shows no extra box, and a longer PIN's length never leaks ahead.
  const shown = length ?? Math.max(minLength ?? 4, Math.min(value.length, max))
  const clean = (raw: string) =>
    (alphanumeric ? raw.replaceAll(/[^a-zA-Z0-9]/g, '') : raw.replaceAll(/\D/g, ''))
      .toUpperCase()
      .slice(0, max)

  function valueFrom(raw: string): string {
    if (!secret) {
      return clean(raw)
    }
    if (raw.length < value.length) {
      return value.slice(0, raw.length)
    }
    return clean(value + raw.slice(value.length))
  }

  // The masked value is rebuilt from the field's tail, so the caret must stay at the end.
  function pinCaretToEnd(field: HTMLInputElement) {
    if (!secret) {
      return
    }
    const end = field.value.length
    if (field.selectionStart !== end || field.selectionEnd !== end) {
      field.setSelectionRange(end, end)
    }
  }

  function glyphAt(position: number) {
    if (position >= value.length) {
      return ' '
    }
    return secret ? '•' : value[position]
  }

  function cellAt(position: number) {
    const filled = position < value.length
    // The cursor marks where the next digit lands, and only while a visible box awaits one.
    const active =
      focused && !settled && value.length < max && position === value.length && position < shown
    return (
      <div
        key={position}
        className={
          active ? `${styles.codeInputCell} ${styles.codeInputCellActive}` : styles.codeInputCell
        }
        data-part="cell"
        aria-hidden
      >
        {glyphAt(position)}
        {active && !filled ? <span className={styles.codeInputCaret} /> : null}
      </div>
    )
  }

  function startsGroup(position: number) {
    return groupSize !== undefined && position > 0 && position % groupSize === 0
  }

  const positions = Array.from({ length: shown }, (_, position) => position)
  const boxes = positions.flatMap((position) =>
    startsGroup(position)
      ? [
          <div key={`separator-${position}`} className={styles.codeInputSeparator} aria-hidden />,
          cellAt(position),
        ]
      : [cellAt(position)],
  )

  return (
    <div
      className={[
        styles.codeInput,
        error ? styles.codeInputError : '',
        settled ? styles.codeInputSettled : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {boxes}
      <input
        id={id}
        className={styles.codeInputField}
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
        onSelect={(event) => pinCaretToEnd(event.currentTarget)}
        onChange={(event) => onChange(valueFrom(event.currentTarget.value))}
        onPaste={(event: ClipboardEvent<HTMLInputElement>) => {
          event.preventDefault()
          onChange(clean(event.clipboardData.getData('text')))
        }}
      />
    </div>
  )
}
