import { Alert, Button, Card, Center, Group, Loader, Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import type { AuthTokens } from '../auth/api'
import { useMe } from './useMe'

export function Picker({ onProfileSelected }: { onProfileSelected: (tokens: AuthTokens) => void }) {
  const { data, loading, error } = useMe()
  const { selectHousehold, selectProfile } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)

  // Scope upgrades account → household → profile, so select the household first even when the
  // user clicks a profile directly. selectProfile's token result is what advances the session.
  async function choose(householdId: string, profileId: string) {
    setBusy(profileId)
    try {
      await selectHousehold(householdId)
      onProfileSelected(await selectProfile(profileId))
    } finally {
      setBusy(null)
    }
  }

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

  return (
    <Stack>
      <Title order={2}>Who's watching?</Title>
      {data.me.memberships.map((membership) => (
        <Card key={membership.householdId} withBorder>
          <Text fw={600}>{membership.householdName}</Text>
          <Group mt="sm">
            {membership.profiles.map((profile) => (
              <Button
                key={profile.id}
                variant={profile.active ? 'filled' : 'light'}
                loading={busy === profile.id}
                onClick={() => choose(membership.householdId, profile.id)}
              >
                {profile.name}
              </Button>
            ))}
          </Group>
        </Card>
      ))}
    </Stack>
  )
}
