import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AmbientScope } from './AmbientScope'

const THEME = {
  base: '#0e3b34',
  panel: '#1a4740',
  selected: '#1f6b5a',
  accent: '#6fe0bf',
  onAccent: '#06231c',
  textPrimary: '#f2fcf8',
  textSecondary: '#8fb5aa',
}

describe('AmbientScope', () => {
  it('exposes every theme slot as an ambient custom property around its children', () => {
    render(
      <AmbientScope theme={THEME}>
        <p>Content</p>
      </AmbientScope>,
    )
    const scope = screen.getByTestId('ambient-scope')
    expect(scope).toContainElement(screen.getByText('Content'))
    expect(scope.style.getPropertyValue('--ambient-base')).toBe('#0e3b34')
    expect(scope.style.getPropertyValue('--ambient-panel')).toBe('#1a4740')
    expect(scope.style.getPropertyValue('--ambient-selected')).toBe('#1f6b5a')
    expect(scope.style.getPropertyValue('--ambient-accent')).toBe('#6fe0bf')
    expect(scope.style.getPropertyValue('--ambient-on-accent')).toBe('#06231c')
    expect(scope.style.getPropertyValue('--ambient-text-primary')).toBe('#f2fcf8')
    expect(scope.style.getPropertyValue('--ambient-text-secondary')).toBe('#8fb5aa')
  })

  it('sets no ambient properties without a theme, so the neutral tokens apply', () => {
    render(
      <AmbientScope theme={null}>
        <p>Content</p>
      </AmbientScope>,
    )
    const scope = screen.getByTestId('ambient-scope')
    expect(scope.style.getPropertyValue('--ambient-base')).toBe('')
    expect(scope.style.getPropertyValue('--ambient-accent')).toBe('')
    expect(screen.getByText('Content')).toBeInTheDocument()
  })
})
