import type { CSSProperties, ReactNode } from 'react'
import styles from './AmbientScope.module.css'
import type { AmbientTheme } from './ambientTheme'

// Applies a title's server-derived theme as --ambient-* custom properties. Every consumer reads
// them with the neutral token as fallback, so a missing theme needs no branching anywhere else
// (principle 1: ambient color lives on detail pages only).
export function AmbientScope({ theme, children }: { theme: AmbientTheme | null; children: ReactNode }) {
  return (
    <div className={styles.scope} style={theme ? themeVariables(theme) : undefined} data-testid="ambient-scope">
      {children}
    </div>
  )
}

function themeVariables(theme: AmbientTheme): CSSProperties {
  return {
    '--ambient-base': theme.base,
    '--ambient-panel': theme.panel,
    '--ambient-selected': theme.selected,
    '--ambient-accent': theme.accent,
    '--ambient-on-accent': theme.onAccent,
    '--ambient-text-primary': theme.textPrimary,
    '--ambient-text-secondary': theme.textSecondary,
  } as CSSProperties
}
