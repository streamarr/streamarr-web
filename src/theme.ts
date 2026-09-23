import {
  Button,
  CloseButton,
  PasswordInput,
  Select,
  TextInput,
  colorsTuple,
  createTheme,
  type CSSVariablesResolver,
} from '@mantine/core'
import { createElement, Fragment } from 'react'
import buttonStyles from './styles/button.module.css'
import styles from './styles/field.module.css'
import { Icon } from './ui/Icon'

// Values reference the generated tokens (src/styles/tokens.generated.css) as CSS custom
// properties rather than copying them, so re-vendoring restyles the app without touching this.
export const theme = createTheme({
  // Brand hues live only in the gradient; interaction accents are blue.deep.
  colors: {
    streamarr: colorsTuple('var(--color-blue-deep)'),
  },
  primaryColor: 'streamarr',
  components: {
    // 42px controls everywhere: Mantine's md, so a button beside an input shares its height.
    Button: Button.extend({
      defaultProps: { size: 'md' },
      classNames: { root: buttonStyles.button },
    }),
    TextInput: TextInput.extend({ defaultProps: { size: 'md' } }),
    InputWrapper: {
      classNames: { label: styles.fieldLabel, required: styles.fieldRequired },
    },
    Input: {
      classNames: { input: styles.fieldInput },
    },
    PasswordInput: PasswordInput.extend({
      defaultProps: {
        size: 'md',
        visibilityToggleIcon: ({ reveal }) =>
          createElement(Icon, {
            name: reveal ? 'hide-password' : 'show-password',
            size: 20,
          }),
      },
    }),
    CloseButton: CloseButton.extend({
      defaultProps: { icon: createElement(Icon, { name: 'close', size: 16 }) },
    }),
    Select: Select.extend({
      defaultProps: {
        size: 'md',
        rightSection: createElement(Icon, { name: 'chevron-down', size: 16 }),
        renderOption: ({ option, checked }) =>
          createElement(
            Fragment,
            null,
            checked && createElement(Icon, { name: 'check', size: 16 }),
            createElement('span', null, option.label),
          ),
      },
    }),
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
