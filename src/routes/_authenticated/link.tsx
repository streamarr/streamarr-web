import { AuthShell } from '../../ui/AuthShell'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { LinkDevice } from '../../pairing/LinkDevice'

interface LinkSearch {
  code?: string
}

export const Route = createFileRoute('/_authenticated/link')({
  validateSearch: (search: Record<string, unknown>): LinkSearch =>
    typeof search.code === 'string' ? { code: search.code } : {},
  component: LinkDevicePage,
})

function LinkDevicePage() {
  const { code } = Route.useSearch()
  const { session } = Route.useRouteContext()
  const navigate = useNavigate()
  // Read once: the strip below would otherwise clear the field.
  const [initialCode] = useState(code ?? '')

  // The code is only a pre-fill; the address bar, shared links, and proxy logs must not keep it.
  useEffect(() => {
    if (code) {
      void navigate({ to: '/link', search: {}, replace: true })
    }
  }, [code, navigate])

  return (
    <AuthShell width={560}>
      <LinkDevice
      initialCode={initialCode}
      onUnauthenticated={(pendingCode) => {
        // Recorded first, or /login's cached-session gate would turn the visitor straight back.
        session.markAnonymous()
        return navigate({
          to: '/login',
          search: {
            redirect: pendingCode ? `/link?code=${encodeURIComponent(pendingCode)}` : '/link',
          },
        })
      }}
      />
    </AuthShell>
  )
}
