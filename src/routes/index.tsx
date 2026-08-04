import { Alert, Center, Loader, Stack, Text, Title } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { extractAuthContext } from '../graphql/errorRouting'
import { useMe } from '../identity/useMe'

export const Route = createFileRoute('/')({
  component: Home,
})

// The authenticated shell: rendering me proves the profile-scoped loop works. A me query that
// 401s or lacks a profile is caught by the Apollo error link and routed to /login or /select.
function Home() {
  const { data, loading, error } = useMe()

  if (loading) {
    return (
      <Center h={200}>
        <Loader />
      </Center>
    )
  }

  if (error || !data) {
    const context = extractAuthContext(error)
    const message =
      context.networkStatus === 403 &&
      context.networkCode === 'CSRF_TOKEN_REQUIRED'
        ? 'Your session security check failed. Reload the page and try again.'
        : "Couldn't load your library. Try again."
    return (
      <Alert color="red" role="alert">
        {message}
      </Alert>
    )
  }

  return (
    <Stack>
      <Title order={2}>Welcome, {data.me.displayName}</Title>
      <Text c="dimmed">Library browsing lands here.</Text>
    </Stack>
  )
}
