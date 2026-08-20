import {
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import type { AuthTokens } from '../auth/api'
import type { MeQuery } from '../graphql/generated/graphql'
import { PinDialog } from './PinDialog'
import { useMe } from './useMe'

type SelectableProfile = MeQuery['me']['selectableProfiles']['edges'][number]['node']

// Frame 15: the Profile picker of the context Household, with the Household switcher when the
// Personal Profile is shared into other Households. A locked Profile stays visible but cannot be
// chosen — the lock is the Household's PIN safety rule, not a permission. Selecting a protected
// Profile opens the PIN gate (frame 15a); the server ceremony decides everything else.
export function Picker({ onProfileSelected }: { onProfileSelected: (tokens: AuthTokens) => void }) {
  const { data, loading, error, refetch } = useMe()
  const { selectHousehold, selectProfile } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const [pinFor, setPinFor] = useState<SelectableProfile | null>(null)

  if (loading) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    )
  }

  if (error || !data) {
    return (
      <Alert color="red" role="alert">
        Couldn't load your profiles. Try again.
      </Alert>
    )
  }

  const me = data.me
  const households = me.usableHouseholds.edges.map((edge) => edge.node)
  const profiles = me.selectableProfiles.edges.map((edge) => edge.node)

  async function switchTo(householdId: string) {
    if (householdId === me.contextHousehold.id) {
      return
    }
    setSwitching(true)
    try {
      await selectHousehold(householdId)
      await refetch()
    } finally {
      setSwitching(false)
    }
  }

  async function choose(profile: SelectableProfile) {
    if (profile.locked) {
      return
    }
    if (profile.pinConfigured) {
      setPinFor(profile)
      return
    }
    setBusy(profile.id)
    try {
      onProfileSelected(await selectProfile(profile.id))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Stack>
      <Title order={2}>Who's watching?</Title>
      {households.length > 1 && (
        <SegmentedControl
          aria-label="Household"
          value={me.contextHousehold.id}
          disabled={switching}
          onChange={switchTo}
          data={households.map((usable) => ({
            value: usable.household.id,
            label: usable.membership ? `${usable.household.name} (Home)` : usable.household.name,
          }))}
        />
      )}
      <Group>
        {profiles.map((profile) => (
          <Tooltip
            key={profile.id}
            label="Locked until a PIN is set for this Profile"
            disabled={!profile.locked}
          >
            <Button
              variant={profile.selected ? 'filled' : 'light'}
              loading={busy === profile.id}
              data-disabled={profile.locked || undefined}
              onClick={() => choose(profile)}
              rightSection={badgeFor(profile)}
            >
              {profile.name}
            </Button>
          </Tooltip>
        ))}
      </Group>
      {profiles.length === 0 && (
        <Text c="dimmed">No Profiles are available in {me.contextHousehold.name} yet.</Text>
      )}
      {pinFor && (
        <PinDialog
          profileName={pinFor.name}
          onClose={() => setPinFor(null)}
          onSubmit={async (pin) => {
            onProfileSelected(await selectProfile(pinFor.id, pin))
          }}
        />
      )}
    </Stack>
  )
}

function badgeFor(profile: SelectableProfile) {
  if (profile.locked) {
    return <Badge color="gray">Locked</Badge>
  }
  if (profile.kind === 'KID') {
    return <Badge color="teal">Kid</Badge>
  }
  if (profile.personal) {
    return <Badge color="blue">You</Badge>
  }
  return null
}
