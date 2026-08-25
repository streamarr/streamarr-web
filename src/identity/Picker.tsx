import { Alert, Center, Loader, SegmentedControl, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { AuthApiError, type AuthTokens } from '../auth/api'
import type { MeQuery } from '../graphql/generated/graphql'
import { AuthTitle } from '../ui/AuthShell'
import { ProfileTile } from '../ui/ProfileTile'
import { PinGate } from './PinGate'
import { useMe } from './useMe'
import styles from './Picker.module.css'

type SelectableProfile = MeQuery['me']['selectableProfiles']['edges'][number]['node']

const SESSION_REFUSALS = new Set(['AUTHENTICATION_REQUIRED', 'EXPIRED_TOKEN', 'INVALID_TOKEN'])

// pinProfileId is the route's to keep in the URL, so the browser's Back can leave the gate.
export function Picker({
  pinProfileId,
  onPinRequested,
  onPinDismissed,
  onProfileSelected,
  onUnauthenticated,
}: {
  pinProfileId?: string
  onPinRequested: (profileId: string) => void
  onPinDismissed: () => void
  onProfileSelected: (tokens: AuthTokens) => void
  onUnauthenticated: () => void
}) {
  const { data, loading, error } = useMe()
  const { selectHousehold, selectProfile } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

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
    setFailure(null)
    setSwitching(true)
    try {
      // The auth boundary resets the Apollo store, which refetches the active Me.
      await selectHousehold(householdId)
    } catch (error) {
      refuse(error, "Couldn't switch Households. Try again.")
    } finally {
      setSwitching(false)
    }
  }

  function refuse(error: unknown, fallback: string) {
    if (isSessionRefusal(error)) {
      onUnauthenticated()
      return
    }
    setFailure(refusalMessage(error, fallback))
  }

  // The gate shows its own refusals; only a dead session is taken off its hands.
  async function select(request: () => Promise<AuthTokens>) {
    try {
      onProfileSelected(await request())
    } catch (error) {
      if (!isSessionRefusal(error)) {
        throw error
      }
      onUnauthenticated()
    }
  }

  async function choose(profile: SelectableProfile) {
    if (profile.locked) {
      return
    }
    if (profile.pinConfigured) {
      onPinRequested(profile.id)
      return
    }
    setFailure(null)
    setBusy(profile.id)
    try {
      onProfileSelected(await selectProfile(profile.id))
    } catch (error) {
      refuse(error, "Couldn't select that Profile. Try again.")
    } finally {
      setBusy(null)
    }
  }

  const gated = findGatedProfile(profiles, pinProfileId)
  if (gated) {
    return (
      <PinGate
        profileName={gated.name}
        paletteIndex={profiles.findIndex((profile) => profile.id === gated.id)}
        onSwitchProfile={onPinDismissed}
        onSubmit={(pin: string) => select(() => selectProfile(gated.id, pin))}
      />
    )
  }

  return (
    <Stack gap={28}>
      <AuthTitle>Who's watching?</AuthTitle>
      {failure && (
        <Alert color="red" role="alert">
          {failure}
        </Alert>
      )}
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
      <div className={styles.profileTiles}>
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

// A deep link must never open a gate the grid itself would refuse.
function findGatedProfile(
  profiles: SelectableProfile[],
  pinProfileId: string | undefined,
): SelectableProfile | undefined {
  return profiles.find(
    (profile) => profile.id === pinProfileId && profile.pinConfigured && !profile.locked,
  )
}

function refusalMessage(error: unknown, fallback: string): string {
  if (!(error instanceof AuthApiError)) {
    return fallback
  }
  return error.serverMessage ?? fallback
}

function isSessionRefusal(error: unknown): boolean {
  return (
    error instanceof AuthApiError &&
    error.status === 401 &&
    error.code !== null &&
    SESSION_REFUSALS.has(error.code)
  )
}
