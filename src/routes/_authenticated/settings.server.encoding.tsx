import { createFileRoute } from '@tanstack/react-router'
import { EncodingSettings } from '../../admin/encoding/EncodingSettings'

export const Route = createFileRoute('/_authenticated/settings/server/encoding')({
  component: EncodingSettings,
})
