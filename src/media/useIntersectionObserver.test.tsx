import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { intersectionObserverInstances } from '../../vitest.setup'
import { useIntersectionObserver } from './useIntersectionObserver'

function Sentinel({ onChange }: { onChange: (entries: IntersectionObserverEntry[]) => void }) {
  const ref = useIntersectionObserver(onChange)
  return <div ref={ref} />
}

describe('useIntersectionObserver', () => {
  it('observes the attached element', () => {
    render(<Sentinel onChange={() => {}} />)
    const observer = intersectionObserverInstances.at(-1)
    expect(observer?.observe).toHaveBeenCalledTimes(1)
  })

  it('invokes the handler with the entries the observer reports', () => {
    const onChange = vi.fn()
    render(<Sentinel onChange={onChange} />)
    const observer = intersectionObserverInstances.at(-1)!
    const entry = { isIntersecting: true } as IntersectionObserverEntry

    observer.callback([entry], observer)

    expect(onChange).toHaveBeenCalledWith([entry])
  })

  it('disconnects the observer on unmount', () => {
    const { unmount } = render(<Sentinel onChange={() => {}} />)
    const observer = intersectionObserverInstances.at(-1)!

    unmount()

    expect(observer.disconnect).toHaveBeenCalledTimes(1)
  })
})
