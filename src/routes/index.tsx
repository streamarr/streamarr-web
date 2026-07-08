import { Center, Loader, Stack, Text, Title } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useMe } from '../identity/useMe'

export const Route = createFileRoute('/')({
  component: Home,
})

// The authenticated shell: rendering me proves the profile-scoped loop works. A me query that
// 401s or lacks a profile is caught by the Apollo error link and routed to /login or /select.
function Home() {
  const { data, loading } = useMe()

  if (loading) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    )
  }

  return (
    <Stack>
      <Title order={2}>Welcome{data ? `, ${data.me.displayName}` : ''}</Title>
      <Text c="dimmed">Library browsing lands here.</Text>
    </Stack>
  )
}
