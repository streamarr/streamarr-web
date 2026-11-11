import { useQuery } from '@apollo/client/react'
import { Alert, Center, Loader } from '@mantine/core'
import { Link } from '@tanstack/react-router'
import { MeDocument } from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { FailurePanel } from '../ui/Failure'
import { SettingsLayout, type SettingsSection } from '../ui/SettingsLayout'
import { canManageServer } from './access'

const SECTIONS = [
  {
    to: '/settings/server/libraries',
    icon: 'folder',
    label: 'Libraries',
    region: 'Library administration',
  },
  { to: '/settings/server/encoding', icon: 'encoding', label: 'Encoding', region: 'Encoding' },
  {
    to: '/settings/server/streams',
    icon: 'play',
    label: 'Active streams',
    region: 'Active streams',
  },
  {
    to: '/settings/server/sharing',
    icon: 'sharing',
    label: 'Sharing and invitations',
    region: 'Sharing and invitations',
  },
] as const satisfies readonly SettingsSection[]

/** The settings shell: sections mount only after the server confirms the admin's access on entry. */
export function ServerSettings() {
  const { data, error, refetch } = useQuery(MeDocument, {
    fetchPolicy: 'network-only',
  })

  if (error)
    return (
      <FailurePanel onRetry={refetch}>
        {requestFailureMessage(error, "Couldn't confirm your access to server settings.")}
      </FailurePanel>
    )
  if (!data)
    return (
      <Center h={200}>
        <Loader role="status" aria-label="Checking server settings access" />
      </Center>
    )
  if (!canManageServer(data.me))
    return (
      <Alert role="alert">
        Server settings are available to server admins using an account session.{' '}
        <Link to="/">Back to Home</Link>
      </Alert>
    )

  return <SettingsLayout title="Server settings" sections={SECTIONS} />
}
