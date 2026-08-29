import { describe, expect, it } from 'vitest'
import { resolveAmbientColors } from './ambientSource'

const THEME = {
  base: '#0e3b34',
  panel: '#1a4740',
  selected: '#1f6b5a',
  accent: '#6fe0bf',
  onAccent: '#06231c',
  textPrimary: '#f2fcf8',
  textSecondary: '#8fb5aa',
}

function colored(primary: string) {
  return {
    ambientColors: {
      topLeft: '#0d322c',
      topRight: '#0d322c',
      bottomRight: '#071f1b',
      bottomLeft: '#071f1b',
      primary,
      theme: THEME,
    },
  }
}

const UNCOLORED = { ambientColors: null }

describe('resolveAmbientColors', () => {
  it('tints from the first candidate list whose leading image carries ambient colors', () => {
    const colors = resolveAmbientColors([colored('#6fe0bf')], [colored('#e9b658')])
    expect(colors?.primary).toBe('#6fe0bf')
  })

  it('falls through a backdrop the server has not colored yet to the next candidate', () => {
    const colors = resolveAmbientColors([UNCOLORED], [colored('#e9b658')])
    expect(colors?.primary).toBe('#e9b658')
  })

  it('skips empty and absent candidate lists', () => {
    const colors = resolveAmbientColors([], null, undefined, [null, colored('#e9b658')])
    expect(colors?.primary).toBe('#e9b658')
  })

  it('returns null when nothing is colored, leaving the page neutral', () => {
    expect(resolveAmbientColors([UNCOLORED], [])).toBeNull()
  })
})
