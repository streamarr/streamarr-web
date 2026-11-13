import { useLayoutEffect, useRef, useState } from 'react'

/**
 * A page's notice and the heading it returns focus to. A change often removes the element that
 * had focus, such as the button of a row that the change took away, and focus then falls to the
 * page's body. Announcing the change moves focus to the page's heading only then. Focus that is
 * still on an element of the page stays there, so a person who moved on keeps their place and
 * hears the notice from its status. Dismissing the notice takes its own button away, so the same
 * rule follows a dismissal.
 */
export function usePageNotice() {
  // Each announcement counts, so that the same words a second time are a new notice.
  const [notice, setNotice] = useState({ text: '', count: 0 })
  const heading = useRef<HTMLHeadingElement>(null)

  // After the render of an announcement or a dismissal, the elements that it removed are gone from
  // the page.
  useLayoutEffect(() => {
    if (notice.count === 0 || document.activeElement !== document.body) return
    heading.current?.focus({ preventScroll: true })
  }, [notice])

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
