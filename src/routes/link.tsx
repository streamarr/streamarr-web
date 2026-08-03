import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { LinkDevice } from '../pairing/LinkDevice'

interface LinkSearch {
  code?: string
}

export const Route = createFileRoute('/link')({
  validateSearch: (search: Record<string, unknown>): LinkSearch =>
    typeof search.code === 'string' ? { code: search.code } : {},
  component: Link,
})

function Link() {
  const { code } = Route.useSearch()
  const navigate = useNavigate()
  // Read once: the effect below removes it from the URL, and re-reading would clear the field.
  const [initialCode] = useState(code ?? '')

  // A code in the query is only ever a pre-fill, and today only arrives on the way back from
  // signing in. Strip it so it cannot be shoulder-surfed from the address bar, pasted into a
  // shared link, or written to a proxy's access log. It is never auto-submitted.
  useEffect(() => {
    if (code) {
      window.history.replaceState(null, '', '/link')
    }
  }, [code])

  return (
    <LinkDevice
      initialCode={initialCode}
      onUnauthenticated={(pendingCode) =>
        navigate({
          to: '/login',
          search: { redirect: '/link', code: pendingCode || undefined },
        })
      }
    />
  )
}
