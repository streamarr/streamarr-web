import { AuthShell } from '../../ui/AuthShell'
import { createFileRoute, useLocation, useNavigate } from '@tanstack/react-router'
import { signInResuming } from '../../auth/resume'
import { Picker } from '../../identity/Picker'

// The PIN gate is a history entry (?profile=<id>), so deep links, refresh, and Back all just work.
export const Route = createFileRoute('/_authenticated/select-profile')({
  validateSearch: (search: Record<string, unknown>): { profile?: string } =>
    typeof search.profile === 'string' ? { profile: search.profile } : {},
  component: SelectProfile,
})

function SelectProfile() {
  const navigate = useNavigate()
  const { profile } = Route.useSearch()
  const { session } = Route.useRouteContext()
  const location = useLocation()
  return (
    <AuthShell width={640}>
      <Picker
        pinProfileId={profile}
        onPinRequested={(profileId) =>
          navigate({ to: '/select-profile', search: { profile: profileId } })
        }
        onPinDismissed={() => navigate({ to: '/select-profile', search: {}, replace: true })}
        onProfileSelected={() => navigate({ to: '/' })}
        onUnauthenticated={() => {
          // Record the eviction first, or /login's cached-session gate would bounce straight back.
          session.markAnonymous()
          return navigate(signInResuming(location))
        }}
      />
    </AuthShell>
  )
}
