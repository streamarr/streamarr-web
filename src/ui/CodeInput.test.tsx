import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { CodeInput } from './CodeInput'

function Harness({ minLength, length }: { minLength?: number; length?: number }) {
  const [value, setValue] = useState('')
  return (
    <CodeInput
      label="PIN"
      value={value}
      onChange={setValue}
      minLength={minLength}
      length={length}
      secret
    />
  )
}

function cells() {
  return document.querySelectorAll('.codeInputCell').length
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

  it('shouldKeepAFixedLengthFixed', async () => {
    const user = userEvent.setup()
    render(<Harness length={8} />)

    await user.type(screen.getByLabelText('PIN'), '123')

    expect(cells()).toBe(8)
  })
})
