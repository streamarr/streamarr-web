import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { LinkDevice } from '../../pairing/LinkDevice'

interface LinkSearch {
  code?: string
}

export const Route = createFileRoute('/_authenticated/link')({
  validateSearch: (search: Record<string, unknown>): LinkSearch =>
    typeof search.code === 'string' ? { code: search.code } : {},
  component: Link,
})

// Approving a device is an account action; the _authenticated layout has already made the
// server vouch for the session before this renders. A session that dies while the code is being
// typed is the lookup's 401 to answer, and it must still carry the typed code back.
function Link() {
  const { code } = Route.useSearch()
  const { session } = Route.useRouteContext()
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
      onUnauthenticated={(pendingCode) => {
        // Every eviction records the store's answer before bouncing — otherwise /login's
        // cached-session gate would turn the evicted visitor straight back around.
        session.markAnonymous()
        return navigate({
          to: '/login',
          search: {
            redirect: pendingCode ? `/link?code=${encodeURIComponent(pendingCode)}` : '/link',
          },
        })
      }}
    />
  )
}
