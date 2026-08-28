import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { intersectionObserverInstances } from '../../vitest.setup'
import { useVisibleLetter } from './useVisibleLetter'

function Harness({ letters }: { letters: string[] }) {
  const { visibleLetter, registerItem } = useVisibleLetter()
  return (
    <div>
      <div data-testid="visible-letter">{visibleLetter ?? 'none'}</div>
      {letters.map((letter) => (
        <div key={letter} ref={registerItem(letter)} data-letter={letter} />
      ))}
    </div>
  )
}

describe('useVisibleLetter', () => {
  it('starts with no visible letter', () => {
    const { getByTestId } = render(<Harness letters={['A', 'N']} />)
    expect(getByTestId('visible-letter')).toHaveTextContent('none')
  })

  it('reports the letter of whichever registered item crosses the top band', () => {
    const { getByTestId } = render(<Harness letters={['A', 'N']} />)
    const nObserver = intersectionObserverInstances.at(-1)!
    const nElement = nObserver.observe.mock.calls[0][0] as Element

    act(() => {
      nObserver.callback([{ target: nElement, isIntersecting: true } as IntersectionObserverEntry], nObserver)
    })

    expect(getByTestId('visible-letter')).toHaveTextContent('N')
  })

  it('clears back to none once the item leaves the top band', () => {
    const { getByTestId } = render(<Harness letters={['A']} />)
    const observer = intersectionObserverInstances.at(-1)!
    const element = observer.observe.mock.calls[0][0] as Element

    act(() => {
      observer.callback([{ target: element, isIntersecting: true } as IntersectionObserverEntry], observer)
    })
    expect(getByTestId('visible-letter')).toHaveTextContent('A')

    act(() => {
      observer.callback([{ target: element, isIntersecting: false } as IntersectionObserverEntry], observer)
    })
    expect(getByTestId('visible-letter')).toHaveTextContent('none')
  })
})
