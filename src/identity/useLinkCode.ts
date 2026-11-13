import { useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { codeInFragment } from './fragmentCode'

/**
 * The code that the link which opened the page carried in its fragment, as in `#code=BCDFGHJK`,
 * or null. The hook then takes the code out of the address, so a reload, the address bar and the
 * history keep no code.
 */
export function useLinkCode(): string | null {
  const fragment = useLocation({ select: (location) => location.hash })
  const navigate = useNavigate()
  // Read once: the navigation below empties the fragment, and the code must outlive that.
  const [code] = useState(() => codeInFragment(fragment))

  useEffect(() => {
    if (codeInFragment(fragment) !== null) {
      void navigate({ to: '.', replace: true })
    }
  }, [fragment, navigate])

  return code
}
