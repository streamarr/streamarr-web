import { createFileRoute } from '@tanstack/react-router'
import { SharingScreen } from '../../identity/SharingScreen'
import { useLinkCode } from '../../identity/useLinkCode'

export const Route = createFileRoute('/_authenticated/settings/profile/sharing')({
  component: SharingPage,
})

// A share code link opens the form once. A reload, the address bar and the history keep no code.
function SharingPage() {
  const code = useLinkCode()
  return <SharingScreen arrivingCode={code} />
}
