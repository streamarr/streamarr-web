import { useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { codeInFragment } from './fragmentCode'

/** The code that the latest link to the page carried, and a count that changes with each new link. */
export interface LinkCode {
  /** The code that the latest link carried in its fragment, or null when no link carried one. */
  code: string | null
  /**
   * Counts the links with a code that reached the page while it stayed open. A link pasted into
   * the address bar of the open page changes only the fragment, so the browser keeps the page. A
   * screen keyed by this count opens afresh with each new link's code, as a page load would.
   */
  arrivals: number
}

/**
 * The code that a link to the page carries in its fragment, as in `#code=BCDFGHJK`. The hook then
 * takes the code out of the address, so a reload, the address bar and the history keep no code.
 */
export function useLinkCode(): LinkCode {
  const fragment = useLocation({ select: (location) => location.hash })
  const navigate = useNavigate()
  const [latest, setLatest] = useState(() => ({
    fragment,
    code: codeInFragment(fragment),
    arrivals: 0,
  }))

  // The code outlives the navigation below, which empties the fragment.
  if (fragment !== latest.fragment) {
    const code = codeInFragment(fragment)
    setLatest(
      code === null ? { ...latest, fragment } : { fragment, code, arrivals: latest.arrivals + 1 },
    )
  }

  useEffect(() => {
    if (codeInFragment(fragment) !== null) {
      void navigate({ to: '.', replace: true })
    }
  }, [fragment, navigate])

  return { code: latest.code, arrivals: latest.arrivals }
}
