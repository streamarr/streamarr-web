import { createTheme, type CSSVariablesResolver } from '@mantine/core'

/**
 * The Mantine theme, fed from the generated design tokens (src/styles/tokens.generated.css,
 * vendored from streamarr-ux at the commit pinned in TOKENS_REF). Values are referenced as
 * CSS custom properties rather than copied, so re-vendoring the tokens restyles the app
 * without touching this file.
 *
 * Deliberately minimal: radius slots and the resolver below. Spacing-slot and type-scale
 * binding land with the component work (streamarr-ux components.yaml); fonts land when the
 * typeface phase vendors them.
 */
export const theme = createTheme({
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
