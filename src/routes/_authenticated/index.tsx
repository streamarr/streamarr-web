import { Alert, Center, Loader, Stack, Text, Title } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { CSRF_REJECTION_MESSAGE, isCsrfRejection } from '../../auth/csrf'
import { extractAuthContext } from '../../graphql/errorRouting'
import { useMe } from '../../identity/useMe'

export const Route = createFileRoute('/_authenticated/')({
  component: Home,
})

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
    const message = isCsrfRejection(context.networkStatus, context.networkCode)
      ? CSRF_REJECTION_MESSAGE
      : "Couldn't load your library. Try again."
    return (
      <Alert color="red" role="alert">
        {message}
      </Alert>
    )
  }

  return (
    <Stack gap={4}>
      <Title order={2}>Welcome, {data.me.displayName}</Title>
      <Text c="dimmed">Library browsing lands here.</Text>
    </Stack>
  )
}
