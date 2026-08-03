import { Alert, Center, Loader } from '@mantine/core'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { decideAuthRoute, extractAuthContext } from '../graphql/errorRouting'
import { useMe } from '../identity/useMe'
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
  const { data, loading, error } = useMe()
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

  // Approving a device is an account action, so the form is for signed-in visitors only. The
  // page cannot read the httpOnly session cookies — and its own auth state is empty after a
  // reload — so the server decides, by answering me. A 401 there is routed to /login by the
  // Apollo error link, carrying the way back; a session that dies later is LinkDevice's 401.
  if (loading || isAlreadyBouncing(error)) {
    return (
      <Center h={200}>
        <Loader role="status" aria-label="Checking your account" />
      </Center>
    )
  }

  if (!data) {
    return (
      <Alert color="red" role="alert">
        Couldn't confirm you're signed in. Reload the page to try again.
      </Alert>
    )
  }

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

/** An error the Apollo error link already turned into a redirect: reporting it would race it. */
function isAlreadyBouncing(error: unknown): boolean {
  return !!error && decideAuthRoute(extractAuthContext(error)) !== null
}
