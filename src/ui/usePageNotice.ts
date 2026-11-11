import { useRef, useState } from 'react'

/**
 * A page's notice and the heading it returns focus to. A change often removes the row whose
 * button had focus, so announcing the change moves focus to the page's heading.
 */
export function usePageNotice() {
  const [notice, setNotice] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)

  function announce(text: string) {
    setNotice(text)
    heading.current?.focus({ preventScroll: true })
  }

  return { notice, heading, announce, dismiss: () => setNotice('') }
}
