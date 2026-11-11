import { useRef, useState } from 'react'

/**
 * A page's notice and the heading it returns focus to. A change often removes the row whose
 * button had focus, so announcing the change moves focus to the page's heading. A result that
 * leaves the page as it was, such as a copy, is announced `inPlace` and keeps focus where it is.
 */
export function usePageNotice() {
  // Each announcement counts, so that the same words a second time are a new notice.
  const [notice, setNotice] = useState({ text: '', count: 0 })
  const heading = useRef<HTMLHeadingElement>(null)

  function announce(text: string, { inPlace = false }: { inPlace?: boolean } = {}) {
    setNotice((last) => ({ text, count: last.count + 1 }))
    if (!inPlace) heading.current?.focus({ preventScroll: true })
  }

  return {
    notice: notice.text,
    count: notice.count,
    heading,
    announce,
    dismiss: () => setNotice((last) => ({ ...last, text: '' })),
  }
}
