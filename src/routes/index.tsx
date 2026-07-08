import { Stack, Text, Title } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return (
    <Stack>
      <Title order={2}>Library</Title>
      <Text c="dimmed">The authenticated shell renders here once the me query is wired.</Text>
    </Stack>
  )
}
