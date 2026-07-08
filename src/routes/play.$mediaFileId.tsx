import { Text, Title } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/play/$mediaFileId')({
  component: Play,
})

function Play() {
  const { mediaFileId } = Route.useParams()
  return (
    <>
      <Title order={2}>Playback</Title>
      <Text c="dimmed">hls.js player for media file {mediaFileId} lands here.</Text>
    </>
  )
}
