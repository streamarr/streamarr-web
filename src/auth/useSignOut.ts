import { useAuth } from './AuthProvider'

export function useSignOut(onSignedOut: () => void): () => void {
  const { logout } = useAuth()
  return () => {
    // Revocation is best-effort: an outage must never trap someone in a session they left.
    void logout().catch(() => {})
    onSignedOut()
  }
}
