import { createFileRoute } from '@tanstack/react-router'
import { SharingScreen } from '../../identity/SharingScreen'
import { useLinkCode } from '../../identity/useLinkCode'

export const Route = createFileRoute('/_authenticated/settings/profile/sharing')({
  component: SharingPage,
})

// Each share code link opens the form once, also on a Sharing page that is already open. A reload,
// the address bar and the history keep no code.
function SharingPage() {
  const { code, arrivals } = useLinkCode()
  return <SharingScreen key={arrivals} arrivingCode={code} />
}
