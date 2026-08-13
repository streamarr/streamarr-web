import { createTheme, type CSSVariablesResolver } from '@mantine/core'

/**
 * The Mantine theme, fed from the generated design tokens (src/styles/tokens.generated.css,
 * vendored from streamarr-ux at the commit pinned in TOKENS_REF). Values are referenced as
 * CSS custom properties rather than copied, so re-vendoring the tokens restyles the app
 * without touching this file.
 *
 * Deliberately minimal: the two font families, radius slots, and the resolver below.
 * Spacing-slot and type-scale binding land with the component work
 * (streamarr-ux components.yaml).
 */
export const theme = createTheme({
  /**
   * The content voice, app-wide (principle 9.1) — the mocks set Space Grotesk
   * once at the root and inherit it everywhere. The system voice (JetBrains
   * Mono) is opt-in per component via the monospace family; its uppercase +
   * tracking contract binds with component work.
   */
  fontFamily: "'Space Grotesk', var(--font-family-content)",
  fontFamilyMonospace: "'JetBrains Mono', var(--font-family-system)",
  defaultRadius: 'md',
  radius: {
    xs: 'var(--radius-sm)',
    sm: 'var(--radius-sm)',
    md: 'var(--radius-md)',
    lg: 'var(--radius-lg)',
    xl: 'var(--radius-xl)',
  },
})

/**
 * Repoints Mantine's own variables at the token layer: the page ground and text come from
 * the neutral tokens (not Mantine's dark palette), and error states use the semantic token.
 * The app is dark-first; the light block stays empty on purpose.
 */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {},
  dark: {
    '--mantine-color-body': 'var(--color-ground)',
    '--mantine-color-text': 'var(--text-primary)',
    '--mantine-color-error': 'var(--semantic-error)',
  },
})
