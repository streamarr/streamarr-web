import { act, render, screen } from '@testing-library/react'
import { Suspense, startTransition, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { intersectionObserverInstances } from '../../vitest.setup'
import { useIntersectionObserver } from './useIntersectionObserver'

function Sentinel({ onChange }: { onChange: (entries: IntersectionObserverEntry[]) => void }) {
  const ref = useIntersectionObserver(onChange)
  return <div ref={ref} />
}

describe('useIntersectionObserver', () => {
  it('keeps the committed handler while a concurrent update is suspended', async () => {
    const seen: string[] = []
    const pending = new Promise<never>(() => {})
    let change!: () => void
    function SuspendingSentinel({ version }: { version: string }) {
      const ref = useIntersectionObserver(() => seen.push(version))
      if (version === 'uncommitted') throw pending
      return <div ref={ref}>{version}</div>
    }
    function Harness() {
      const [version, setVersion] = useState('committed')
      change = () => startTransition(() => setVersion('uncommitted'))
      return (
        <Suspense fallback="pending">
          <SuspendingSentinel version={version} />
        </Suspense>
      )
    }
    render(<Harness />)
    const observer = intersectionObserverInstances.at(-1)!
    await act(async () => {
      change()
    })
    expect(screen.getByText('committed')).toBeInTheDocument()
    act(() => observer.callback([], observer))
    expect(seen).toEqual(['committed'])
  })

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
