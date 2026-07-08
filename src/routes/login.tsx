import { Text, Title } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/login')({
  component: Login,
})

function Login() {
  return (
    <>
      <Title order={2}>Sign in</Title>
      <Text c="dimmed">Cookie-mode login form lands here.</Text>
    </>
  )
}
