import { useQuery } from '@apollo/client/react'
import { Alert, Center, Loader } from '@mantine/core'
import { Link } from '@tanstack/react-router'
import { MeDocument } from '../graphql/generated/graphql'
import { requestFailureMessage } from '../graphql/requestErrors'
import { FailurePanel } from '../ui/Failure'
import { SettingsLayout, type SettingsSection } from '../ui/SettingsLayout'
import { canManageHousehold } from './householdAccess'

const SECTIONS = [
  {
    to: '/settings/household/offers',
    icon: 'share-offers',
    label: 'Share offers',
    region: 'Share offers',
  },
  {
    to: '/settings/household/codes',
    icon: 'share-code',
    label: 'Share codes',
    region: 'Share codes',
  },
  {
    to: '/settings/household/visitors',
    icon: 'visitors',
    label: 'Shared with us',
    region: 'Shared with us',
  },
] as const satisfies readonly SettingsSection[]

/**
 * The settings of the Household that the Account is a member of. Its sections mount only after
 * the server confirms, on entry, that the Account is one of its admins.
 */
export function HouseholdSettings() {
  const { data, error, refetch } = useQuery(MeDocument, {
    fetchPolicy: 'network-only',
  })

  if (error)
    return (
      <FailurePanel onRetry={refetch}>
        {requestFailureMessage(error, "Couldn't confirm your access to Household settings.")}
      </FailurePanel>
    )
  if (!data)
    return (
      <Center h={200}>
        <Loader role="status" aria-label="Checking Household settings access" />
      </Center>
    )
  if (!canManageHousehold(data.me))
    return (
      <Alert role="alert">
        Household settings are available to Household admins using an account session.{' '}
        <Link to="/">Back to Home</Link>
      </Alert>
    )

  return <SettingsLayout title="Household settings" sections={SECTIONS} />
}
