import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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

  it('drops an unmounted item instead of letting it keep winning as topmost forever', () => {
    const { getByTestId, rerender } = render(<Harness letters={['HASH']} />)
    const hashObserver = intersectionObserverInstances.at(-1)!
    const hashElement = hashObserver.observe.mock.calls[0][0] as Element
    act(() => {
      hashObserver.callback([{ target: hashElement, isIntersecting: true } as IntersectionObserverEntry], hashObserver)
    })
    expect(getByTestId('visible-letter')).toHaveTextContent('HASH')

    // A letter jump replaces the whole edges array: the HASH item unmounts, a J item mounts.
    // disconnect() alone (no synthetic not-intersecting event) must not leave HASH stuck forever
    // once J is confirmed intersecting — even though HASH is still in `intersecting` at this
    // exact instant (its own cleanup already ran, but isConnected pruning is lazy).
    rerender(<Harness letters={['J']} />)

    const jObserver = intersectionObserverInstances.at(-1)!
    const jElement = jObserver.observe.mock.calls[0][0] as Element
    act(() => {
      jObserver.callback([{ target: jElement, isIntersecting: true } as IntersectionObserverEntry], jObserver)
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
