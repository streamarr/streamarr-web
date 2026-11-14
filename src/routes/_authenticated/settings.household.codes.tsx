import { createFileRoute } from '@tanstack/react-router'
import { ShareCodesScreen } from '../../identity/ShareCodesScreen'

export const Route = createFileRoute('/_authenticated/settings/household/codes')({
  component: ShareCodesPage,
})

function ShareCodesPage() {
  // A page served over plain http, as on a LAN, gets no clipboard: copying then says it failed.
  const clipboard = (navigator.clipboard as Clipboard | undefined) ?? null
  return <ShareCodesScreen clipboard={clipboard} origin={window.location.origin} />
}
