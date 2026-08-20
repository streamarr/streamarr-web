import { Alert, Center, Loader, SegmentedControl, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import type { AuthTokens } from '../auth/api'
import type { MeQuery } from '../graphql/generated/graphql'
import { ProfileTile } from '../ui/ProfileTile'
import { PinGate } from './PinGate'
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

  // Frame 15a is a full state of this screen, not an overlay (principle 11).
  if (pinFor) {
    const gated = pinFor
    return (
      <PinGate
        profileName={gated.name}
        paletteIndex={profiles.findIndex((profile) => profile.id === gated.id)}
        onSwitchProfile={() => setPinFor(null)}
        onSubmit={async (pin: string) => {
          onProfileSelected(await selectProfile(gated.id, pin))
        }}
      />
    )
  }

  return (
    <Stack gap={28}>
      <h1 className="authTitle">Who's watching?</h1>
      {households.length > 1 && (
        <SegmentedControl
          aria-label="Household"
          value={me.contextHousehold.id}
          disabled={switching}
          onChange={switchTo}
          data={households.map((usable) => ({
            value: usable.household.id,
            label: usable.household.name,
          }))}
        />
      )}
      <div className="profileTiles">
        {profiles.map((profile, index) => (
          <ProfileTile
            key={profile.id}
            name={profile.name}
            kid={profile.kind === 'KID'}
            pinProtected={profile.pinConfigured}
            locked={profile.locked}
            paletteIndex={index}
            busy={busy === profile.id}
            onSelect={() => choose(profile)}
          />
        ))}
      </div>
      {profiles.length === 0 && (
        <Text c="dimmed">No Profiles are available in {me.contextHousehold.name} yet.</Text>
      )}
    </Stack>
  )
}
