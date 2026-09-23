import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { intersectionObserverInstances } from '../../vitest.setup'
import { useVisibleLetter } from './useVisibleLetter'

function Harness({ letters, root = null }: { letters: string[]; root?: Element | null }) {
  const { visibleLetter, registerItem } = useVisibleLetter(root)
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
  it.each([100, 150])(
    'selects the visually first item despite callback order (first top=%s)',
    (firstTop) => {
      const { container, getByTestId } = render(<Harness letters={['A', 'N']} />)
      const a = container.querySelector('[data-letter="A"]')!
      const n = container.querySelector('[data-letter="N"]')!
      vi.spyOn(a, 'getBoundingClientRect').mockReturnValue({ top: firstTop } as DOMRect)
      vi.spyOn(n, 'getBoundingClientRect').mockReturnValue({ top: 150 } as DOMRect)
      const aObserver = intersectionObserverInstances.find((o) =>
        o.observe.mock.calls.some((call) => call[0] === a),
      )!
      const nObserver = intersectionObserverInstances.find((o) =>
        o.observe.mock.calls.some((call) => call[0] === n),
      )!
      act(() => {
        nObserver.callback(
          [{ target: n, isIntersecting: true } as IntersectionObserverEntry],
          nObserver,
        )
        aObserver.callback(
          [{ target: a, isIntersecting: true } as IntersectionObserverEntry],
          aObserver,
        )
      })
      expect(getByTestId('visible-letter')).toHaveTextContent('A')
    },
  )

  it('starts with no visible letter', () => {
    const { getByTestId } = render(<Harness letters={['A', 'N']} />)
    expect(getByTestId('visible-letter')).toHaveTextContent('none')
  })

  it('keeps the visible letter across re-renders of connected items', () => {
    const { getByTestId, rerender } = render(<Harness letters={['A', 'N']} />)
    const nObserver = intersectionObserverInstances.at(-1)!
    const nElement = nObserver.observe.mock.calls[0][0] as Element

    act(() => {
      nObserver.callback(
        [{ target: nElement, isIntersecting: true } as IntersectionObserverEntry],
        nObserver,
      )
    })

    expect(getByTestId('visible-letter')).toHaveTextContent('N')

    rerender(<Harness letters={['A', 'N']} />)

    expect(getByTestId('visible-letter')).toHaveTextContent('N')
  })

  it('clears back to none once the item leaves the top band', () => {
    const { getByTestId } = render(<Harness letters={['A']} />)
    const observer = intersectionObserverInstances.at(-1)!
    const element = observer.observe.mock.calls[0][0] as Element

    act(() => {
      observer.callback(
        [{ target: element, isIntersecting: true } as IntersectionObserverEntry],
        observer,
      )
    })
    expect(getByTestId('visible-letter')).toHaveTextContent('A')

    act(() => {
      observer.callback(
        [{ target: element, isIntersecting: false } as IntersectionObserverEntry],
        observer,
      )
    })
    expect(getByTestId('visible-letter')).toHaveTextContent('none')
  })

  it('drops an unmounted item instead of letting it keep winning as topmost forever', () => {
    const { getByTestId, rerender } = render(<Harness letters={['HASH']} />)
    const hashObserver = intersectionObserverInstances.at(-1)!
    const hashElement = hashObserver.observe.mock.calls[0][0] as Element
    act(() => {
      hashObserver.callback(
        [{ target: hashElement, isIntersecting: true } as IntersectionObserverEntry],
        hashObserver,
      )
    })
    expect(getByTestId('visible-letter')).toHaveTextContent('HASH')

    // A letter jump replaces the items without a final intersection event for the old item.
    rerender(<Harness letters={['J']} />)

    const jObserver = intersectionObserverInstances.at(-1)!
    const jElement = jObserver.observe.mock.calls[0][0] as Element
    act(() => {
      jObserver.callback(
        [{ target: jElement, isIntersecting: true } as IntersectionObserverEntry],
        jObserver,
      )
    })
    expect(getByTestId('visible-letter')).toHaveTextContent('J')
  })

  it('observes against the given scroll container, not the default viewport', () => {
    const container = document.createElement('div')
    render(<Harness letters={['A']} root={container} />)
    const observer = intersectionObserverInstances.at(-1)!
    expect(observer.root).toBe(container)
  })
})
