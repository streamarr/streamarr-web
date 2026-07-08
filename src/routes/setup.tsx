import { Text, Title } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/setup')({
  component: Setup,
})

function Setup() {
  return (
    <>
      <Title order={2}>First-run setup</Title>
      <Text c="dimmed">Setup wizard (email, password, household, profile) lands here.</Text>
    </>
  )
}
