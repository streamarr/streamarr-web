import { rem, Text, type TextProps } from '@mantine/core'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import styles from './AuthShell.module.css'

export function AuthShell({ width = 400, children }: { width?: number; children: ReactNode }) {
  return (
    <div className={styles.authShell}>
      <div className={styles.authShellBloom} />
      <div className={styles.authShellScrim} />
      <div className={styles.authShellColumn} style={{ maxWidth: rem(width) }}>
        <Wordmark />
        {children}
      </div>
    </div>
  )
}

// The one sanctioned gradient-text rendering: a version of the mark, not text.
export function Wordmark() {
  return <div className={styles.wordmark}>STREAMARR</div>
}

// A plain h1 on purpose: Mantine's Title zeroes the margin the ceremonies' rhythm relies on.
export function AuthTitle({ className, ...props }: ComponentPropsWithoutRef<'h1'>) {
  return <h1 {...props} className={joinClasses(styles.authTitle, className)} />
}

export function AuthLede({ className, ...props }: TextProps & { children?: ReactNode }) {
  return <Text {...props} className={joinClasses(styles.authLede, className)} />
}

function joinClasses(...names: (string | undefined)[]) {
  return names.filter(Boolean).join(' ')
}
