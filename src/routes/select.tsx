import { Text, Title } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/select')({
  component: Select,
})

function Select() {
  return (
    <>
      <Title order={2}>Who's watching?</Title>
      <Text c="dimmed">Household and profile picker over the me query lands here.</Text>
    </>
  )
}
