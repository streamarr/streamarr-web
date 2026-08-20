import type { ReactNode } from 'react'
import './auth.css'

// The shared frame of every auth ceremony (frames 12-15a): black ground, the brand bloom,
// a left scrim, and one left-anchored column under the wordmark. Layout chrome only — each
// screen keeps its own heading and content, so screens stay testable in isolation.
export function AuthShell({ width = 400, children }: { width?: number; children: ReactNode }) {
  return (
    <div className="authShell">
      <div className="authShellBloom" />
      <div className="authShellScrim" />
      <div className="authShellColumn" style={{ maxWidth: width }}>
        <Wordmark />
        {children}
      </div>
    </div>
  )
}

// The one sanctioned gradient-text rendering (principle 2.4): a version of the mark, not text.
export function Wordmark() {
  return <div className="wordmark">STREAMARR</div>
}
