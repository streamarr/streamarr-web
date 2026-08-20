import { createFileRoute } from '@tanstack/react-router'
import { ResetPasswordScreen } from '../auth/ResetPasswordScreen'

export const Route = createFileRoute('/reset')({
  validateSearch: (search: Record<string, unknown>): { code?: string } => ({
    code: typeof search.code === 'string' && search.code.length > 0 ? search.code : undefined,
  }),
  component: Reset,
})

function Reset() {
  const { code } = Route.useSearch()
  return <ResetPasswordScreen initialCode={code} />
}
