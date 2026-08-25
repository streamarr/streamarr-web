import { rem } from '@mantine/core'
import type { ReactNode } from 'react'
import './auth.css'

export function AuthShell({ width = 400, children }: { width?: number; children: ReactNode }) {
  return (
    <div className="authShell">
      <div className="authShellBloom" />
      <div className="authShellScrim" />
      <div className="authShellColumn" style={{ maxWidth: rem(width) }}>
        <Wordmark />
        {children}
      </div>
    </div>
  )
}

// The one sanctioned gradient-text rendering: a version of the mark, not text.
export function Wordmark() {
  return <div className="wordmark">STREAMARR</div>
}
