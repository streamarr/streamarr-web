import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { CodeInput } from './CodeInput'

function Harness({ minLength, length }: { minLength?: number; length?: number }) {
  const [value, setValue] = useState('')
  return (
    <>
      <CodeInput
        label="PIN"
        value={value}
        onChange={setValue}
        minLength={minLength}
        length={length}
        secret
      />
      <output data-testid="value">{value}</output>
    </>
  )
}

function cells() {
  return screen.queryAllByTestId('code-input-cell').length
}

describe('CodeInput', () => {
  it('shouldReadCompleteAtTheFloorWithoutSummoningAnotherBox', async () => {
    const user = userEvent.setup()
    render(<Harness minLength={4} />)

    await user.type(screen.getByLabelText('PIN'), '1234')

    // A four-digit PIN fully typed is four filled boxes — a fifth would imply it isn't done.
    expect(cells()).toBe(4)
  })

  it('shouldGrowOnlyWhenAFifthDigitActuallyArrives', async () => {
    const user = userEvent.setup()
    render(<Harness minLength={4} />)

    await user.type(screen.getByLabelText('PIN'), '12345')

    expect(cells()).toBe(5)
  })

  it('shouldShrinkBackWhenTheExtraDigitIsDeleted', async () => {
    const user = userEvent.setup()
    render(<Harness minLength={4} />)
    await user.type(screen.getByLabelText('PIN'), '12345')

    await user.keyboard('{Backspace}')

    expect(cells()).toBe(4)
  })

  it('shouldBlinkACaretWhereTheNextDigitLands', async () => {
    const user = userEvent.setup()
    render(<Harness minLength={4} />)

    await user.type(screen.getByLabelText('PIN'), '12')

    // A dedicated blinking element: a printed bar would read as a character.
    expect(screen.queryByTestId('code-input-caret')).not.toBeNull()
  })

  it('shouldRestTheCaretWhenTheFloorIsReached', async () => {
    const user = userEvent.setup()
    render(<Harness minLength={4} />)

    await user.type(screen.getByLabelText('PIN'), '1234')

    // Complete-at-the-floor shows four filled boxes and no caret asking for a fifth.
    expect(screen.queryByTestId('code-input-caret')).toBeNull()
  })

  it('shouldAppendADigitTypedAfterTheCaretWasMovedBack', async () => {
    const user = userEvent.setup()
    render(<Harness minLength={4} />)
    const field = screen.getByLabelText('PIN')

    await user.type(field, '12')
    await user.keyboard('{ArrowLeft}3')

    expect(field).toHaveValue('•••')
    expect(screen.getByTestId('value')).toHaveTextContent('123')
  })

  it('shouldDeleteTheLastDigitOnBackspaceAfterTheCaretWasMovedBack', async () => {
    const user = userEvent.setup()
    render(<Harness minLength={4} />)
    const field = screen.getByLabelText('PIN')

    await user.type(field, '123')
    await user.keyboard('{ArrowLeft}{Backspace}')

    expect(screen.getByTestId('value')).toHaveTextContent('12')
  })

  it('shouldKeepAFixedLengthFixed', async () => {
    const user = userEvent.setup()
    render(<Harness length={8} />)

    await user.type(screen.getByLabelText('PIN'), '123')

    expect(cells()).toBe(8)
  })

  it('shouldDrawASeparatorBetweenEachGroupOfBoxes', () => {
    render(<CodeInput label="Code" value="" onChange={() => {}} length={8} groupSize={4} />)

    const boxes = [
      ...document.querySelectorAll(
        '[data-testid=code-input-cell], [data-testid=code-input-separator]',
      ),
    ]
    expect(boxes.map((box) => box.getAttribute('data-testid'))).toEqual([
      ...Array<string>(4).fill('code-input-cell'),
      'code-input-separator',
      ...Array<string>(4).fill('code-input-cell'),
    ])
  })

  it('shouldShowEachTypedCharacterUnlessTheCodeIsSecret', () => {
    const { rerender } = render(
      <CodeInput label="Code" value="AB" onChange={() => {}} length={4} alphanumeric />,
    )
    const shown = () => screen.getAllByTestId('code-input-cell').map((cell) => cell.textContent)

    expect(shown()).toEqual(['A', 'B', '\u00a0', '\u00a0'])

    rerender(<CodeInput label="Code" value="AB" onChange={() => {}} length={4} secret />)

    expect(shown()).toEqual(['•', '•', '\u00a0', '\u00a0'])
  })
})
