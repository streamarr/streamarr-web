import { colorsTuple, createTheme, type CSSVariablesResolver } from '@mantine/core'

// Values reference the generated tokens (src/styles/tokens.generated.css) as CSS custom
// properties rather than copying them, so re-vendoring restyles the app without touching this.
export const theme = createTheme({
  // Brand hues live only in the gradient; interaction accents are blue.deep.
  colors: {
    streamarr: colorsTuple('var(--color-blue-deep)'),
  },
  primaryColor: 'streamarr',
  components: {
    InputWrapper: {
      classNames: { label: 'fieldLabel', required: 'fieldRequired' },
    },
    Input: {
      classNames: { input: 'fieldInput' },
    },
  },
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

// Dark-first: the light block stays empty on purpose.
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {},
  dark: {
    '--mantine-color-body': 'var(--color-ground)',
    '--mantine-color-text': 'var(--text-primary)',
    '--mantine-color-error': 'var(--semantic-error)',
  },
})
