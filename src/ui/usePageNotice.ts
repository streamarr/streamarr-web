import { useLayoutEffect, useRef, useState } from 'react'

/**
 * A page's notice and the heading it returns focus to. A change often removes the element that
 * had focus, such as the button of a row that the change took away, and focus then falls to the
 * page's body. Announcing the change moves focus to the page's heading only then. Focus that is
 * still on an element of the page stays there, so a person who moved on keeps their place and
 * hears the notice from its status.
 */
export function usePageNotice() {
  // Each announcement counts, so that the same words a second time are a new notice.
  const [notice, setNotice] = useState({ text: '', count: 0 })
  const heading = useRef<HTMLHeadingElement>(null)

  // After the change's render, the elements that the change removed are gone from the page.
  useLayoutEffect(() => {
    if (notice.count === 0 || document.activeElement !== document.body) return
    heading.current?.focus({ preventScroll: true })
  }, [notice.count])

  function announce(text: string) {
    setNotice((last) => ({ text, count: last.count + 1 }))
  }

  return {
    notice: notice.text,
    count: notice.count,
    heading,
    announce,
    dismiss: () => setNotice((last) => ({ ...last, text: '' })),
  }
}
